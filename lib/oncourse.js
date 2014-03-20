var path = require('path');
var fs = require('fs');
var lib = path.join(path.dirname(fs.realpathSync(__filename)), '../lib');


module.exports.Client = require(lib+'/oncourse/client.js');
