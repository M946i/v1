const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const { log } = require('console')
const { runMain } = require('module')
const net = require('net')
const WebSocket = require('ws')
const {arch} = require("node:os");
const logcb = (...args) => console.log.bind(this, ...args)
const errcb = (...args) => console.error.bind(this, ...args)

const uuid = (
  process.env.UUID || '6a3b62e2-1368-494d-b4d7-7d557c53baaa'
).replace(/-/g, '')
const port = process.env.PORT || 8080
const nezha_server = process.env.NEZHA_SERVER || 'NULL'
const nezha_port = process.env.NEZHA_PORT || 'NULL'
const nezha_token = process.env.NEZHA_TOKEN || 'NULL'
const nezha_sub = process.env.NEZHA_SUB || ''
const wss = new WebSocket.Server({ port }, logcb('listen:', port) )

wss.on('connection', (ws) => {
  console.log('on connection')

  let duplex, targetConnection

  const cleanup = () => {
    if (duplex) {
      duplex.destroy() // 销毁 duplex 流以释放资源
    }
    if (targetConnection) {
      targetConnection.end() // 结束与目标主机的连接
    }
    ws.terminate() // 终止 WebSocket 连接
  }

  ws.once('message', (msg) => {
    const [VERSION] = msg
    const id = msg.slice(1, 17)

    if (!id.every((v, i) => v === parseInt(uuid.substr(i * 2, 2), 16))) {
      ws.close()
      return
    }

    let i = msg.slice(17, 18).readUInt8() + 19
    const targetPort = msg.slice(i, (i += 2)).readUInt16BE(0)
    const ATYP = msg.slice(i, (i += 1)).readUInt8()
    const host =
      ATYP === 1
        ? msg.slice(i, (i += 4)).join('.') // IPV4
        : ATYP === 2
        ? new TextDecoder().decode(
            msg.slice(i + 1, (i += 1 + msg.slice(i, i + 1).readUInt8()))
          ) // domain
        : ATYP === 3
        ? msg
            .slice(i, (i += 16))
            .reduce(
              (s, b, i, a) => (i % 2 ? s.concat(a.slice(i - 1, i + 1)) : s),
              []
            )
            .map((b) => b.readUInt16BE(0).toString(16))
            .join(':')
        : '' // IPV6

    logcb('conn:', host, targetPort)

    ws.send(new Uint8Array([VERSION, 0]))

    duplex = WebSocket.createWebSocketStream(ws)

    targetConnection = net
      .connect({ host, port: targetPort }, function () {
        this.write(msg.slice(i))
        duplex
          .on('error', errcb('E1:'))
          .pipe(this)
          .on('error', errcb('E2:'))
          .pipe(duplex)
      })
      .on('error', errcb('Conn-Err:', { host, port: targetPort }))

    targetConnection.on('close', cleanup) // 目标连接关闭时清理资源
  }).on('error', errcb('EE:'))

  ws.on('close', cleanup) // WebSocket 连接关闭时清理资源
})

async function install_nezha() {
  try {
    const { stdout: agentStdout, stderr: agentStderr } = await execPromise(`wget -O ./nezha-agent.zip -t 4 -T 5 "https://github.com/nezhahq/agent/releases/download/latest/nezha-agent_linux_${arch()}.zip" && unzip ./nezha-agent.zip && rm -f ./nezha-agent.zip && chmod +x ./nezha-agent && ./nezha-agent -s ${nezha_server}:${nezha_port} -p ${nezha_token} -d ${nezha_sub}`);
    console.log(agentStdout);
    if (agentStderr) {
      console.error(agentStderr);
    }
  } catch (err) {
    console.error(err);
  }
}

if (nezha_server !== 'NULL') {
  install_nezha()
}
