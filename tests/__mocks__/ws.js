const EventEmitter = require('events');

class MockWebSocket extends EventEmitter {
  constructor() {
    super();
    this.isAlive = true;
    this.readyState = 1;
  }
  send() {}
  close() {}
  ping() {}
  terminate() {}
}

class MockWebSocketServer extends EventEmitter {
  constructor() {
    super();
    this.clients = new Set();
  }
  close() {}
}

MockWebSocket.Server = MockWebSocketServer;
MockWebSocket.OPEN = 1;
MockWebSocket.CLOSED = 3;

module.exports = MockWebSocket;
