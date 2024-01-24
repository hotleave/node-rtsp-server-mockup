# Node RTSP Server 模拟器

用 NodeJS 实现的 RTSP Server 模拟器，可用于调试 RTSP 视频问题。用 NodeJS 来进行 RTSP 指令交互，然后用 [rtpplay](https://github.com/irtlab/rtptools) 推流。

## 快速入门

1. 媒体文件准备

- 用 Wireshark 或类似的工具抓取一定时长的 RTSP 数据包，
- 找到 RTSP 的 SDP 信息，将其保存到一个文本文件当中，并命令为 `foo`.sdp
- 找到视频流，并导出 rtpdump 文件，命名格式为：`foo`-video.rtpdump
- 找到音频流，并导出 rtpdump 文件，命名格式为：`foo`-audio.rtpdump，如果没有可以忽略
- 将以上的三个文件（如果没有音频也没有关系）放到`media`目录下，如果放到其他目录，需要在启动服务时加上 `-r` 参数

2. 启动服务

```shell

# 1. 下载项目
git clone ....

# 2. 安装依赖
pnpm install

# 3. 启动服务
node index.js

# node index.js -v -r ./media -h 0.0.0.0
```

3. 播放 rtsp://127.0.0.1:8554/`foo`

### RTP over TCP

1. 将 VLC 的 RTSP 设置为 RTP over RTSP(TCP)
2. 准备好 Wireshark 开始抓包
3. 开始播放，抓包一定的时长后停止播放和抓包
4. 在 Wireshark 中找到 SDP 信息，将其保存到一个文本文件当中，并命令为 `foo`.sdp
5. 在 SDP 信息的 Packet 上点右键，选择追踪流 -> TCP 流
6. 在数据过滤中选择收到的数据，并保存为 `foo`.tcpdata
7. 数据准备完成

## 依赖项

- nodejs
- rtpplay

## 功能列表

- [x] 支持音视频流
- [x] 支持配置监听地址和端口
- [x] 支持多路并发请求
- [ ] 支持认证
- [x] 支持 TCP 流传输协议
- [ ] 支持 mp4 或 mkv 文件