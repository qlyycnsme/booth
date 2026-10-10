# aclub

Arc 上的付费会员房间（一份合约多个房间）。规则全文见 [docs/RULES.md](docs/RULES.md)。

摘要：群员用 USDC 预付一期会费（1/3/6 月可选），退出按停留时间结算；已用额 5% 给运营、95% 进房间费池。开房锁 10 USDC（90 天）。房间**不会**因「群主未续期」自动关闭——到期的是会员会籍，不是群主身份。

## 测试

```bash
export PATH="$PATH:$HOME/.foundry/bin"
forge test -vv
```

## 部署（测试网）

```bash
export OPS_ADDRESS=0x...
export PROTOCOL_OWNER=0x...
forge script script/Deploy.s.sol:DeployScript --rpc-url https://rpc.testnet.arc.io --broadcast
```

## 测试网前端

```bash
cd web
npm install
npm run dev
```

这会同时启动页面（5173）和群聊 WebSocket（8787）。入群后钱包要签一条消息，服务器会核对该地址在合约里是否仍是会员，然后把消息广播给同一房间的所有连接。

浏览器打开 http://localhost:5173 ，钱包切到 Arc Testnet（Chain ID `5042002`）。局域网另一台设备用终端里打印的 Network 地址访问即可互聊。

已部署：

- BoothClub `0x9a7544566926B5577449D4393fE38939E1B94376`
- BOOTH `0xabBFf6eF1f160dbF1e9c96E2b59Da0CDd2568676`

