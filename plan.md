# SOFA RPC Monitor
监控多个RPC节点的状态是否正常，由后端服务和前端页面展示组成。

## 后端backend
node服务。用node-cron每10分钟(暂定)一次定时任务，调用ethers.js的getBlockNumber(),遍历检查每个rpc节点的状态，更新本地rpc_status.json文件。

### 后端配置参数
CRON_EXPRESSION=*/10 * * * *
MAX_ENTRIES=1008  #rpc_status.json每个节点数组的最大长度
PORT=3000
HOST=0.0.0.0

### rpc节点的数据结构
RPC_LIST_JSON是环境变量，json字符串，不要提交到github。示例为结构示意，实际 JSON 需双引号
'{
  "Ethereum": [
    {"name": "example", "rpc": "https://example.com/eth"}
  ],
  "Arbitrum": [
    {"name": "example", "rpc": "https://example.com/arb"}
  ],
  "BSC": [
    {"name": "example", "rpc": "https://example.com/bsc"}
  ],
  "Polygon": [
    {"name": "example", "rpc": "https://example.com/polygon"}
  ],
  "Sei": [
    {"name": "example", "rpc": "https://example.com/sei"}
  ],
  "Sepolia": [
    {"name": "example", "rpc": "https://example.com/sepolia"}
  ],
  "ArbSep": [
    {"name": "example", "rpc": "https://example.com/arbsepolia"}
  ]
}'

### rpc_status.json文件结构
{
  "Ethereum": {
    "lambda":    [{"ts": 1765166259, "status":123}, {"ts": 1765166400, "status":"error message"}, ...],
    "Liy_Yuanh": [{"ts": 1765166259, "status":456}, {"ts": 1765166400, "status":457}, ...],
  },
  "Arbitrum": {
    "lambda": [{"ts": 1765166259, "status":1234}, {"ts": 1765166400, "status":"error message"}, ...],
    "Liy":    [{"ts": 1765166259, "status":1235}, {"ts": 1765166400, "status":"timeout"}, ...],    
  },
  ...
} 

### 定时任务
- 记录秒级时间戳，作为这组数据的ts字段值，每次更新的数据有相同的时间戳。
- 连接各rpc节点，串行调用getBlockNumber()，超时时间10秒，不重试。如果正常返回数据，则它的status为getBlockNumber()返回的blocknumber值；超时则status为timeout，否则status为报错信息截断前100个字符。
- 数组中，新的数据放在后面，最多保存MAX_ENTRIES组数据，最早的数据被删除。

### api服务，使用express
- /api/rpc/health 返回http状态码200，json格式
- /api/rpc/status 参数count，从内存返回每个节点状态数组最近的count个数组元素的JSON，文件rpc_status.json只是快照。只读内存，不读文件；文件只是持久化快照。避免读写同时的问题。
  count没传或大于MAX_ENTRIES，则返回全部
- /api/rpc/interval 返回取样间隔，与 CRON_EXPRESSION (一定是*/N * * * *形式)同步，单位分钟
- 允许前端跨域

## 前端frontend
一个简单的页面，用多个柱状图展示各节点状态的历史，数据从后端/api/rpc/status获得。

### 前端配置参数
MAX_POINTS = 144    //一行最多展示的数据个数

### 展示
- 在电脑和手机上都可以正常显示
- 单列主内容，不需要侧栏
- 请求后端/api/rpc/interval作为刷新间隔
- 请求后端/api/rpc/status，参数MAX_POINTS。
- 页面从上到下依次展示/api/rpc/status返回的所有链的状态柱状图。
- 每个链依次展示各名字的状态柱状图
- 每个状态柱状图占一整行宽度，横行是时间，第一个柱子在最左边，显示最近时间的节点状态，往右依次显示历史状态。
- 时间轴用/api/rpc/status中的ts，使用浏览器本地时区格式化
- 每组数据，status如果是数字，则显示绿色柱；否则显示红色柱子。所有柱子的长度相同。
- 鼠标悬停与柱子上，显示该柱对应的本地时间，状态数字或报错信息。
- 若数据不足，柱状图用空柱占位，不阻塞渲染

## 本地测试
- 服务端：cd backend && npm run start
- 前端：用浏览器打开 frontend/index.html
