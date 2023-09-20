const net = require('net')
const fs = require('fs')
const EventEmitter = require('events');
const { Writable } = require('stream');
const { spawn } = require('child_process')
const { v4: uuidv4 } = require('uuid')
const pkg = require('./package.json')
const debug = require('debug')
const yargs = require('yargs/yargs')
const { hideBin } = require('yargs/helpers')
const log = {
    applog: debug(pkg.name),
    reqlog: debug('request'),
    reslog: debug('response'),
    connlog: debug('connection'),
    rtpplaylog: debug('rtpplay')
}

class Request {
    headers = {}
    #session = {}

    constructor(message, session) {
        const lines = message.split('\r\n')
        const [method, url, version] = lines[0].split(' ')

        this.method = method
        this.url = url
        this.version = version
        this.#session = session

        this.#parseHeaders(lines.slice(1))
    }

    getHeader(name) {
        return this.headers[name]
    }

    get session() {
        return this.#session
    }

    get cseq() {
        return this.headers['CSeq']
    }

    get sessionId() {
        return this.headers['Session']
    }

    #parseHeaders(lines) {
        lines.filter(line => line.indexOf(': ') > 0)
            .forEach(line => {
                const [name, value] = line.split(': ')
                this.headers[name] = value
            });
    }
}

class Response {
    version = 'RTSP/1.0'
    headers = {}
    body = null

    constructor(req) {
        this.cseq = req.cseq
        if (req.sessionId) {
            this.sessionId = req.sessionId
        }
        this.ok()
    }

    ok() {
        this.statusCode = 200
        this.reasonPhrase = 'OK'
    }

    badRequest() {
        this.statusCode = 400
        this.reasonPhrase = 'Bad Request'
    }

    notFound() {
        this.statusCode = 404
        this.reasonPhrase = 'Not Found'
    }

    setStatus(code, reason) {
        this.statusCode = code
        this.reasonPhrase = reason
    }

    setHeader(name, value) {
        this.headers[name] = value
    }

    setBody(body, contentType) {
        this.body = body
        this.setHeader('Content-Length', body.length)
        if (contentType) {
            this.setHeader('Content-Type', contentType)
        }
    }

    toString() {
        const statusLine = `${this.version} ${this.statusCode} ${this.reasonPhrase}`
        const headers = Object.entries(this.headers).map(header => `${header[0]}: ${header[1]}`)

        let message = [statusLine, ...headers, '\r\n'].join('\r\n')
        if (this.body) {
            message += this.body
        }

        return message
    }

    set cseq(cseq) {
        this.setHeader('CSeq', cseq)
    }

    set sessionId(session) {
        this.setHeader('Session', session)
    }

    set contentType(contentType) {
        this.setHeader('Content-Type', contentType)
    }
}

class Session extends Writable {
    id = uuidv4()
    context = { id: this.id.replace(/-/g, '') }

    write(chunk) {
        const message = chunk.toString('utf-8')
        log.reqlog(message)

        const req = new Request(message, this.context)
        log.reqlog('receive client request: %o', req)

        this.emit('request', req)
        return true
    }
}

class RtspServer extends EventEmitter {
    #server
    #rtpPort = 20000
    #root

    constructor(root) {
        super()

        this.#root = root
        if (root.endsWith('/')) {
            this.#root = root.substring(0, root.length - 1)
        }

        const self = this
        const server = self.#server = net.createServer()
        server.on('connection', (socket) => {
            log.connlog('new client connection: %s', socket.remoteAddress)

            socket.on('error', (err) => {
                log.connlog('error on client connection', err.message)
            })

            socket.on('end', () => {
                log.connlog('client connection end')
            })

            socket.on('close', () => {
                log.connlog('client connection closed')
            })

            const session = new Session()
            session.on('request', (req) => {
                req.socket = socket
                const res = new Response(req)
                res.setHeader('Server', `Node-Rtsp-Server/${pkg.version}`)
                const method = req.method.toLowerCase()
                log.applog('handler method: %s', method)

                if (self[method]) {
                    self[method](req, res)
                } else {
                    res.setStatus(405, 'Method Not Allowed')
                }

                log.reslog('send response: %o', res)
                const message = res.toString()
                log.reslog(message)
                socket.write(message)
            })

            socket.pipe(session)
        })
    }

    listen(host, port, callback) {
        this.#server.listen(port, host, callback)
    }

    options(req, res) {
        res.setHeader('Public', 'OPTIONS, DESCRIBE, SETUP, TEARDOWN, PLAY, PAUSE, GET_PARAMETER, SET_PARAMETER')
        res.setHeader('Date', new Date().toUTCString())
    }

    describe(req, res) {
        const pathname = new URL(req.url).pathname
        if (pathname === '') {
            res.setStatus(406, 'Not Acceptable')
            res.setHeader('Warning', '01 nrs "pathname required"')
            return
        }
        log.applog('request resource: %s%s', this.#root, pathname)

        try {
            const sdpFilePath = `${this.#root}${pathname}.sdp`
            if (!fs.existsSync(sdpFilePath)) {
                res.notFound()
                return
            }

            const sdp = fs.readFileSync(sdpFilePath, 'utf-8')
            const medias = this.parseSdp(sdp, pathname)
            const noneExist = medias.map(m => m.dumpFilePath)
                .map(file => fs.existsSync(file))
                .filter(exist => !exist)
            if (noneExist.length > 0) {
                res.notFound()
                return
            }

            Object.assign(req.session, { medias })
            res.setBody(sdp, 'application/sdp')
        } catch (err) {
            log.applog('error occured when reading file: %s', err.message)
            res.setStatus(500, 'Internal Server Error')
        }
    }

    setup(req, res) {
        if (!req.session.medias) {
            res.setStatus(400, 'Bad Request')
            return
        }

        const url = req.url
        const media = req.session.medias.filter(m => url.endsWith(m.control))?.[0]
        if (!media) {
            res.setStatus(404, 'Not Found')
            return
        }

        const transport = req.getHeader('Transport')
        log.reqlog('transport: %s', transport)
        const clientPort = transport.split(';').filter(seg => seg.startsWith('client_port='))[0]
        if (!clientPort) {
            res.setStatus(400, 'Bad Request')
            return
        }
        media.clientRtpPort = clientPort.split('=')[1].split('-')[0]

        const serverPort = `server_port=${this.#rtpPort}-${this.#rtpPort + 1}`
        media.serverRtpPort = this.#rtpPort
        this.#rtpPort += 2

        res.setHeader('Transport', `RTP/AVP/UDP;unicast;${clientPort};${serverPort};ssrc=0;mode="play"`)
        res.setHeader('Date', new Date().toUTCString())
        res.sessionId = `${req.session.id};timeout=60`
    }

    play(req, res) {
        res.setHeader('Date', new Date().toUTCString())

        log.applog('start to send data')
        this.#startRtpplay(req)
    }

    get_parameter(req, res) {
        log.applog('receive client get_parameter request')
        res.setHeader('Date', new Date().toUTCString())
    }

    teardown(req, res) {
        log.applog('stop send data')
        req.session.medias.forEach(media => media.rtpplay.kill('SIGINT'))
    }

    #startRtpplay(req) {
        for (const media of req.session.medias) {
            const rtpplay = media.rtpplay = spawn('rtpplay', ['-T', '-f', media.dumpFilePath, '-s', media.serverRtpPort, `${req.socket.remoteAddress}/${media.clientRtpPort}`])
            rtpplay.stdout.on('data', (chunk) => {
                log.rtpplaylog('rtpplay log for %s: %s', media.media, chunk.toString('utf-8'))
            })
            rtpplay.stderr.on('data', (chunk) => {
                log.rtpplaylog('rtpplay log error for %s: %s', media.media, chunk.toString('utf-8'))
                rtpplay.kill('SIGINT')
            })
            rtpplay.on('close', (code, signal) => {
                if (code !== 0) {
                    log.rtpplaylog('rtpplay progress for %s exit, code=%s, signal=%s', media.media, code, signal)
                }
                req.socket.end()
            })
        }
    }

    parseSdp(sdp, pathname) {
        const lines = sdp.split(/\r\n/)
        let media = ''
        let control = ''
        const medias = []
        for (let line of lines) {
            if (line.startsWith('m=video')) {
                media = 'video'
            } else if (line.startsWith('m=audio')) {
                media = 'audio'
            } else if (line.startsWith('a=control:') && media != '') {
                control = line.substring(10)
            }

            if (media && control) {
                const dumpFilePath = `${this.#root}${pathname}-${media}.rtpdump`
                medias.push({ media, control, dumpFilePath })
                media = ''
                control = ''
            }
        }

        return medias
    }
}

const argv = yargs(hideBin(process.argv))
    .usage('Usage: $0 [options]')
    .version(pkg.version)
    .option('host', { alias: 'h', type: 'string', default: '127.0.0.1', description: 'host to bind on' })
    .option('port', { alias: 'p', type: 'number', default: 8554, description: 'port to bind on' })
    .option('root', { alias: 'r', type: 'string', default: '.', description: 'media folder' })
    .option('verbose', { alias: 'v', type: 'boolean', default: false, description: 'run with verbose loging' })
    .showHelpOnFail(true)
    .parse()

if (argv.verbose) {
    debug.enable('*')
}

const { host, port, root } = argv
const server = new RtspServer(root)
server.listen(host, port, () => {
    log.applog('Server running on %s:%s', argv.host, argv.port)
})

// const sdp = fs.readFileSync('media/ipc.sdp', 'utf-8')
// const medias = server.parseSdp(sdp, '/ipc')
// console.log(medias)
