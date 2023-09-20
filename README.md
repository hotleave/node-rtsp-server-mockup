# Node RTSP Server 模拟器

用 NodeJS 实现的 RTSP Server 模拟器，可用于调试 RTSP 视频问题。用 NodeJS 来进行 RTSP 指令交互，然后用 [rtpplay](https://github.com/irtlab/rtptools) 推流。

## 快速入门

1. 媒体文件准备

- 用 Wireshark 或类似的工具抓取一定时长的数据包，
- 找到 RTSP 的 SDP 信息，将其复制到一个文本中，并命令为 `foo`.sdp
- 分别找到音视频流，并导出 rtpdump 文件，命名格式为：`foo`-video.rtpdump, `foo`-audio.rtpdump
- 将以上的三个文件（如果没有音频也没有关系）放到源码目录下，如果放到其他目录，需要在启动服务时加上 `-r` 参数

2. 启动服务

```shell

# 1. 下载项目
git clone ....

# 2. 安装依赖
pnpm install

# 3. 启动服务
node index.js
```

3. 播放 rtsp://127.0.0.1:8554/`foo`

## 依赖项

- nodejs
- rtpplay

## 功能列表

- [x] 支持音视频流
- [x] 支持配置监听地址和端口
- [x] 支持多路并发请求
- [ ] 支持认证
- [ ] 支持 TCP 流传输协议
- [ ] 支持 mp4 或 mkv 文件