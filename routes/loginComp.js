var express = require('express');
var router = express.Router();
var rclient = require('./redisConnect');
session = require('express-session');
var config = require('../config/config.json');
/* GET Params */
router.param(['vhost','username', 'sessionId'],function(req,res,next,value){
    logger.info('CALLED ONLY ONCE with', value);
    next();
});

// remove session object // using redis client to delete the key
router.get('/destroy', function (req, res) {
    if(req.query.sessionid) {
        var key = currentSessionIDKey  = 'sess:' + req.query.sessionid;
        // logger.info("username>>>"+req.username);
        res.clearCookie('singleui', { path: '/'});
        var username = req.username;
        var smembersKey = "sessions:" + username;
        rclient.smembers(smembersKey, function(err, sessionIds) {
            // logger.info("sessionIds>>>"+JSON.stringify(sessionIds));
            if (sessionIds.length === 0){
                logger.error('could not delete session...sessionIds length: ' + sessionIds.length);
                var myObj = new Object();
                myObj.msg = "Something is wrong here. Please try after some time.";
                res.status(401).end(JSON.stringify(myObj));
            }
            else{
            /** 
             * Delete only current session
             * delete current session key from smembers redis db
             */
                rclient.del(key);
                rclient.srem(smembersKey, currentSessionIDKey);	
                logger.info('session deleted in destroy function');
                var myObj = new Object();
                myObj.msg = "session deleted. login back.";
                res.status(200).end(JSON.stringify(myObj));
            }
        });

        
        
        // logger.info('session_id is :  ' + key);
        // rclient.del(key, function (err) {
        //     if(err) {
        //         logger.error('could not delete session...details: ' + err);
        //         var myObj = new Object();
        //         myObj.msg = "Something is wrong here. Please try after some time.";
        //         res.status(401).end(JSON.stringify(myObj));
        //     } else {
        //         logger.info('session deleted in destroy function');
        //         var myObj = new Object();
        //         myObj.msg = "session deleted. login back.";
        //         res.status(200).end(JSON.stringify(myObj));
        //     }
        // });
    } else {
        var myObj = new Object();
        logger.error('session ID missing');
        myObj.msg = "We are unable to perform this action. Please try after some time.";
        res.status(401).end(JSON.stringify(myObj));
    }
    
});

module.exports = router;