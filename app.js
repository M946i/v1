const { exec } = require('child_process');
const util = require('util');
const net = require('net');
const WebSocket = require('ws');
const https = require('https');
const fs = require('fs');
const logcb = (...args) => console.log.bind(this, ...args);
const errcb = (...args) => console.error.bind(this, ...args);

const uuid = (
  process.env.UUID || '6a3b62e2-1368-494d-b4d7-7d557c53baaa'
).replace(/-/g, '');
const port = process.env.PORT || 8443;

const options = {
  key: fs.readFileSync('/root/v1/private.key'),
  cert: fs.readFileSync('/root/v1/certificate.crt'),
};

const server = https.createServer(options);
const wss = new WebSocket.Server({ server });

server.listen(port, () => console.log(`Listening on port ${port}`));

// Add server error handling
server.on('error', (err) => console.error('HTTPS Server Error:', err));

// Add WebSocket server error handling
wss.on('error', (err) => console.error('WebSocket Server Error:', err));

wss.on('connection', (ws) => {
  console.log('New connection');

  let duplex, targetConnection;

  const cleanup = () => {
    if (duplex) {
      duplex.destroy();
      console.log('Duplex destroyed');
    }
    if (targetConnection) {
      targetConnection.end();
      console.log('Target connection ended');
    }
    ws.terminate();
    console.log('WebSocket terminated');
  };

  // Handle WebSocket errors
  ws.on('error', (err) => {
    console.error('WebSocket Error:', err);
    cleanup();
  });

  ws.once('message', (msg) => {
    try {
      const [VERSION] = msg;
      const id = msg.slice(1, 17);

      if (!id.every((v, i) => v === parseInt(uuid.substr(i * 2, 2), 16))) {
        console.log('UUID mismatch, closing connection');
        ws.close();
        return;
      }

      let i = msg.slice(17, 18).readUInt8() + 19;
      const targetPort = msg.slice(i, (i += 2)).readUInt16BE(0);
      const ATYP = msg.slice(i, (i += 1)).readUInt8();
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
          : ''; // IPV6

      logcb('conn:', host, targetPort);

      ws.send(new Uint8Array([VERSION, 0]));

      duplex = WebSocket.createWebSocketStream(ws);

      // Handle duplex errors
      duplex.on('error', (err) => {
        console.error('Duplex Error:', err);
        cleanup();
      });

      targetConnection = net
        .connect({ host, port: targetPort }, function () {
          this.write(msg.slice(i));
          duplex
            .on('error', errcb('E1:'))
            .pipe(this)
            .on('error', errcb('E2:'))
            .pipe(duplex);
        })
        .on('error', (err) => {
          console.error('Target Connection Error:', err, { host, port: targetPort });
          cleanup();
        });

      targetConnection.on('close', () => {
        console.log('Target connection closed');
        cleanup();
      });
    } catch (err) {
      console.error('Message Processing Error:', err);
      ws.close();
    }
  });

  ws.on('close', () => {
    console.log('WebSocket closed');
    cleanup();
  });
});