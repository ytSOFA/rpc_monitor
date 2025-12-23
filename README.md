# SOFA RPC Monitor

监控多个 RPC 节点的可用性与区块高度，后端定时采样写入快照，前端以柱状图展示历史状态。

## 运行后端

1. 进入后端目录并安装依赖：

```bash
cd backend
npm install
```

2. 配置 `.env` 并启动（可参考 `.env.example`）：

```bash
node server.js
```

## 运行前端

直接打开静态文件
- 先保证后端在 `http://localhost:3000` 运行
- 用浏览器打开 `frontend/index.html`
