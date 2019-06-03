/**
 * @author Sagar Rana
 * Date: 12/5/2018
 * configuring the winston logger
 */
var config = require('../config/config.json');
const { createLogger, format, transports } = require('winston');
const fs = require('fs');
const path = require('path');
const env = config.environment || 'development';

var getLoggerLevel = function () {
    var loggerlevel = config.logger_level;
    if (loggerlevel === undefined || (typeof loggerlevel !== 'string')) {
        return 'info';
    } else {
        return loggerlevel;
    }
};

// messaging format
const formatFile = format.printf(info => {

    return `{ time:'${info.timestamp}', label: [${info.level.toUpperCase()}], message: '${info.message}'}`;
});
const formatConsole = format.printf(info => {
    return `${info.timestamp} - '${info.level.toUpperCase()}' - ${info.message}`;
});

// define the custom settings for each transport (file, console)
const options = {
    console: {
        handleExceptions: true,
        json: false,
        colorize: true,
        format: format.combine(
            format.label({ label: 'level' }),
            format.timestamp(),
            formatConsole
        )
    },
};

// instantiate a new Winston Logger with the settings defined above
var logger = createLogger({
    level: getLoggerLevel(),
    format: format.combine(
        format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss'
        }),
        format.json()),
    transports: [
        new transports.Console(options.console)
    ],
    exitOnError: false, // do not exit on handled exceptions
});

// create a stream object with a 'write' function that will be used by `morgan`
logger.stream = {
    write: function (message, encoding) {
        // use the 'info' log level so the output will be picked up by both transports (file and console)
        logger.info(message);
    },
};

module.exports = logger;
