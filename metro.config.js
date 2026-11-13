const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

config.watcher = {
  ...config.watcher,
  additionalExts: config.watcher?.additionalExts || [],
  watchman: false,
  healthCheck: {
    enabled: false,
  },
};

const originalBlockList = config.resolver?.blockList;
const localRegex = /\.local\/.*/;

if (originalBlockList) {
  if (Array.isArray(originalBlockList)) {
    config.resolver.blockList = [...originalBlockList, localRegex];
  } else {
    config.resolver.blockList = [originalBlockList, localRegex];
  }
} else {
  config.resolver.blockList = localRegex;
}

module.exports = config;
