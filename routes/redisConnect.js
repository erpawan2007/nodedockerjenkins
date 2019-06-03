var redis = require('redis');
// var config = require('./config');
var config = require('../config/config.json');
logger.info(' config fron redisConnect.js  :  ' + config.database.host);
var client = redis.createClient(config.database.port, config.database.host);


client.on('connect', function() {
    logger.info('connected to Redis Database in app.js');
});

// connection error to Redis
client.on('error', function (err) {
    logger.error('Error connecting to Redis... Details :  ' + err);
});

module.exports = client;