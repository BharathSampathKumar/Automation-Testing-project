exports.capabilities = {
  'browserVersion' : 'latest', // Browser version
  "LT:Options" : {
    'visual'  : true,  // To take step by step screenshot
    'network' : true,  // To capture network Logs
    'console' : true, // To capture console logs.
    'w3c' : true,
    "buildTags" : [],
    "plugin": "node_js-mocha"
  }
};

exports.browserNames = ['Chrome', 'Safari', 'MS Edge'];
exports.platforms = ['windows-10', 'macOS Ventura'];