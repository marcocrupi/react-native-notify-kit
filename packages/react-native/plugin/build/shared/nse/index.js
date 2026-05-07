'use strict';

module.exports = {
  ...require('./initNseCore'),
  ...require('./patchPodfile'),
  ...require('./patchXcodeProject'),
};
