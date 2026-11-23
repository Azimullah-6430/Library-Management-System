'use strict';
// Delegate directly to universalBookExtractor (100% dynamic, ZERO mock data)
const { extractBookMetadata } = require('./universalBookExtractor');

module.exports = {
  extractBookMetadata,
};
