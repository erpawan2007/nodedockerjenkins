var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
// var logger = require('morgan');
global.logger = require('./routes/loggerConfig');

// LDAP
var LdapStrategy = require('passport-ldapauth').Strategy;
var passport     = require('passport');
var bodyParser = require('body-parser');

var session = require('express-session');
global.rclient = require('./routes/redisConnect');
var config = require('./config/config.json');
// var config = require(path.resolve('./config/config.json'));
// logger.info(' config fron app.js  :  ' + config.database.host);
var indexRouter = require('./routes/index');
var loginRouter = require('./routes/loginComp');
var ldaploginRouter = require('./routes/ldaplogin');
var ldapuserRouter = require('./routes/ldapUser');
var resetpasswordRouter = require('./routes/resetpassword');
var auth = require('./routes/oauth');
var azureauth = require('./routes/azureoauth');
var libeliumMail = require('./routes/libeliumMail');
var events = require('events');
var redisSessionStore = require('connect-redis')(session);
var eventEmitter = events.EventEmitter();
var app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Environment
// process.env.NODE_ENV =config.environment;

app.all('/*', function(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header('Access-Control-Allow-Origin', req.headers.origin);
    res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Access-Control-Allow-Headers, Authorization,X-Requested-With");
    next();
});
// app.use(logger('dev', {
//   skip: function (req, res) { return res.statusCode < 400 }
// }));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// app.use(express.static(path.join(__dirname, 'public/images')));
app.use('/static', express.static('public'))

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: false}));


var sess = {
    name : config.cookie.name,
    path    : config.cookie.sessionPath,
    secret  : config.cookie.secretKey,
    key     : config.cookie.key,
    proxy   : config.cookie.proxy,
    resave  : config.cookie.resave,
    rolling : config.cookie.rolling,
    saveUninitialized: config.cookie.saveUninitialized,
    unset: 'destroy',
    cookie  : {
        "maxAge": config.cookie.maxAge,
        "httpOnly": config.cookie.httpOnly,
        "path": config.cookie.cookiePath,
        "secure":config.cookie.secure},
    store : new redisSessionStore({
        host: config.database.host,
        port: config.database.port,
        client: rclient
    })
}

// Session Management
app.use(function ( req, res, next) {
    logger.info("Router called>>>"+req.path);
    var errorMsg = new Object();
    if (req.query.sessionid) {
        logger.info("APP.js : Session ID is = " + req.query.sessionid);
        var key = "sess:" + req.query.sessionid;
        rclient.get(key, function (err, response) {
            if(!err) {
                if(response!=null){
                    var result = JSON.parse(response);
                    req.username = result.username;
                    req.vhost = result.o;
                    return next();
                }
                else{
                    errorMsg['message'] = "no content found";
                    errorMsg['session_exist'] = false;
                    res.status(401).send(errorMsg);
                }

            } else{
                logger.error("Error : " + err);
                errorMsg['message'] = "You are not authorize to perform this action. Please login again."
                errorMsg['session_exist'] = false;
                res.status(500).send(errorMsg);
            }
        })
    } else {
        var reqPath = req.path;
        if(reqPath === '/user' || reqPath === '/user/changeCredentials' || reqPath === '/user/linkAcc' || reqPath === '/user/unlinkAcc' || reqPath === '/user/accountsetting')
        {
            errorMsg['message'] = "You are not authorize to perform this action. Please login again."
            errorMsg['session_exist'] = false;
            logger.error(errorMsg['message']);
            res.status(401).send(errorMsg);
        }else{
            return next();
        }
    }
});

app.use(cookieParser());

// Using Sessions
app.use(session(sess));
app.use('/resetpassword',resetpasswordRouter);
app.use('/loginComp', loginRouter);
app.use('/', indexRouter);
app.use('/libeliumMail',libeliumMail);
app.use('/ldaplogin',ldaploginRouter);
app.use('/user',ldapuserRouter);
app.use('/auth',auth);
app.use('/azureauth',azureauth);




// catch 404 and forward to error handler
app.use(function(req, res, next) {
    next(createError(404));
});


// error handler
app.use(function(err, req, res, next) {
    logger.error("err var on app.js -->"+ err);
    // set locals, only providing error in development
    res.locals.message = err.message;
    res.locals.error = req.app.get('env') === 'development' ? err : {};

    // render the error page
    res.status(err.status || 500).send(err.message);
    // res.render('error');
});



module.exports = app;
