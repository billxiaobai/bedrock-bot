const DEFAULT_SERVER_LIST = [
  "bedrock.mcfallout.net",
  "jpb.mcfallout.net",
  "sg.mcfallout.net"
];
const DEFAULT_PORT = 19132;

function createInstance(serverList = DEFAULT_SERVER_LIST.slice(), port = DEFAULT_PORT) {
  let currentIndex = 0;
  function getCurrentHost() { return serverList[currentIndex]; }
  function getCurrentPort() { return port; }
  function switchToNextHost() { currentIndex = (currentIndex + 1) % serverList.length; return getCurrentHost(); }
  function handleErrorLog(log) {
    if (typeof log === 'string' && log.includes("Failed to start bot: Connect timed out")) {
      switchToNextHost();
      return true;
    }
    return false;
  }
  return { getCurrentHost, getCurrentPort, switchToNextHost, handleErrorLog };
}

// 預設 singleton（相容舊程式）
const defaultInstance = createInstance();

module.exports = {
  getCurrentHost: defaultInstance.getCurrentHost,
  getCurrentPort: defaultInstance.getCurrentPort,
  switchToNextHost: defaultInstance.switchToNextHost,
  handleErrorLog: defaultInstance.handleErrorLog,
  getInstance: createInstance
};
module.exports.default = module.exports;
