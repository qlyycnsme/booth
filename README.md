# Booth

Arc 上的付费 club 合约：一份合约多个房间。群员用 USDC 预付月费，退出按停留时间结算；已用额 5% 给运营、95% 进房间群费池。群主开房需质押 BOOTH。群员可向房间金库质押 BOOTH（30 天锁仓），按时间加权取前五，与群主分池子（群主 50%，前五按权重分 50%）。月结为拉取领取，避免单地址转账失败卡住所有人。

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

- BoothClub `0xb928F56b6011A624B55140638eeEB2d3E4C30b98`
- BOOTH `0x35052b4d76b8C4bdf52FFD3105CaDb42CC1CcD82`

