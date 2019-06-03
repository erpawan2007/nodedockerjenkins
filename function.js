var config = require('./config/config.json');
var path = require('path');
var ldap = require('ldapjs');
var request = require('request');
var amqp = require('amqplib')

logger.info("config.sales_email>>>"+config.sales_email);
module.exports = {
    createClient: function () {
        logger.info("Creating ldap client in method: createClient, file:function");
        const ldapUser = config.ldapDetails.user;
        const ldapUserPwd = config.ldapDetails.pwd;
        const ldapServerURL = config.ldapDetails.server;
        const ldapTimeOut = config.ldapDetails.ldapTimeOut;
        const ldapconnectTimeout = config.ldapDetails.ldapconnectTimeout;

        return new Promise(function (resolve, reject) {
            var found = false;
            ldapClient = ldap.createClient({
                url: ldapServerURL,
                reconnect: true,
                timeout: ldapTimeOut,
                connectTimeout: ldapconnectTimeout
            });
            ldapClient.bind(ldapUser, ldapUserPwd, function (err) {
                if (err) {
                    logger.error("bind ldap errror:" + err);
                    // logger.info("exit from createClient method");
                    reject(err);
                }
                else {
                    logger.info("connection created");
                    found = true;
                    resolve(ldapClient);
                }
            });
            ldapClient.on('error', function (err) {
                logger.error('Error while creating ldap client', err.code)
                if (err) {
                    reject(err);
                }
                else {
                    resolve(ldapClient);
                }
            })
            ldapClient.on('timeout', (err) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve(ldapClient);
                }
            });

            ldapClient.on('connectTimeout', (err) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve(ldapClient);
                }
            });

        });
    },
    destroyClient: function(client){
        return new Promise(function(resolve, reject){
            client.unbind(function(err) {
                if(err){
                    reject(err);
                }
                else{
                    logger.info("destroyClient successfully")
                    resolve(true);
                }
            });
        })
    },
    generate: function (len, charSet) {
        charSet = charSet || 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        var randomString = '';
        for (var i = 0; i < len; i++) {
            var randomPoz = Math.floor(Math.random() * charSet.length);
            randomString += charSet.substring(randomPoz, randomPoz + 1);
        }
        return randomString;
    },
    checkExpiration: function (createdTime) {
        let currentTime = new Date().getTime();
        let hours = Math.abs((currentTime - createdTime) / 3600000)
        if (hours > 24) {
            return true;
        }
        else {
            return false;
        }
    },
    /** function for creating hash of given string */
    createhash: function (convertString) {
        const crypto = require('crypto');
        const hash = crypto.createHash('sha256');
        return hash.update(convertString).digest('hex');
    },
    checkUserInRedis: function (searchKey, username) {
        logger.info("Checking user in method: checkUserInRedis, file:function with values searchKey="+searchKey+", username="+username);
        return new Promise(function(resolve, reject){
            rclient.get(searchKey ,function(err,obj){
                if(err){
                    logger.error("Error while try to get redis key")
                    reject(err)
                } else {
                    if (obj === null || obj === '') {
                        resolve(1);
                    } else {
                        var profile = JSON.parse(obj);
                        var userProfile = '';
                        for (var i = 0; i < profile['user'].length; i++) {
                            if (profile['user'][i]['username'] == username) {
                                userProfile = profile['user'][i];
                                break;
                            }
                        }
                        if (userProfile != '') {
                            reject(2)
                        } else {
                            resolve(1)
                        }
                    }
                }
            });
        })
    },
    /** new registered user data will be added in redis */
    insertInRedis: function (custkey, userData) {
        logger.info("Insert user info in method: insertInRedis, file:function");
        return new Promise(function (resolve, reject) {

            rclient.on('error', function (err) {
                logger.error('Error connecting to Redis... Details :  ' + err);
                reject(err);
            });
            module.exports.getKey(custkey)
                .then((getkeyRes) => {

                    if (getkeyRes == null) {
                        module.exports.setKey(custkey, userData)
                            .then((setkeyRes) => {
                                resolve(setkeyRes);
                            })
                            .catch((setkeyErr) => {
                                logger.error("setkeyErr>>>" + setkeyErr);
                                reject(setkeyErr);
                            })
                    } else {
                        // module.exports.checkUserInRedis(custkey, userData.user[0]['username'])
                        // .then((checkResponse)=>{
                        let getExistingData = JSON.parse(getkeyRes);
                        let fetchUser = getExistingData.user;
                        fetchUser.push(userData.user[0]);
                        getExistingData.user = fetchUser;
                        module.exports.setKey(custkey, getExistingData)
                            .then((setkeyRes) => {
                                resolve(setkeyRes);
                            })
                            .catch((setkeyErr) => {
                                logger.error("setkeyErr>>>" + setkeyErr);
                                reject(setkeyErr);
                            })
                        // })
                        // .catch((checkErr) => {
                        //     reject(checkErr);
                        // })

                    }
                })
                .catch((getkeyErr) => {
                    reject(getkeyErr);
                })

        })
    },
    /** function to set key in redis database */
    setKey: function (custkey, info) {
        logger.info("Set key for redis database in method: setKey, file:function");
        return new Promise(function(resolve, reject) {
            logger.info("custkey>>>"+custkey);
            // logger.info("info>>>"+JSON.stringify(info));
            rclient.set(custkey, JSON.stringify(info), function(err, response){
                if (err) {
                    logger.error("setKey Error" + err);
                    reject(err);
                }
                else {
                    resolve(response)
                }
            });
        })
    },
    /** function to search key in redis database */
    getKey: function (custkey) {
        logger.info("get key from redis database in method: getKey, file:function");
        return new Promise(function (resolve, reject) {
            rclient.get(custkey, function (err, response) {
                if (err) {
                    logger.error("getKey Error" + err);
                    reject(err)
                }
                else {
                    resolve(response)
                }
            })
        });
    },

    /** function for delete key in redis database */
    deleteKey: function (custkey) {
        logger.info("deleting key from redis database in method: deleteKey, file:function");
        return new Promise(function (resolve, reject) {
            rclient.del(custkey, function (err, response) {
                if (err) {
                    logger.error("deleteKey Error" + err);
                    reject(err)
                }
                else {
                    resolve(response)
                }
            })
        });
    },

    /** send verification email on user registration */
    registerEmail: function (reqData) {
        logger.info("create register email content in method: registerEmail, file:function");
        return new Promise(function (resolve, reject) {

            var convertString = reqData.email + reqData.firstname + reqData.lastname;
            var hashValue = module.exports.createhash(convertString);

            var vrifyURL = config.siteurl + "verifyaccount/" + hashValue + "/" + reqData.email;
            var emailText = 'Hello ' + reqData.firstname + ' ' + reqData.lastname + ",<br/>";
            emailText += "Your registration with singleUI is almost complete.";
            emailText += " To verify your account please click ";
            emailText += "<a href='" + vrifyURL + "' target='_blank'>here</a> OR copy and paste the below link in browser.<br/>";
            emailText += vrifyURL;
            let mailOptions = {
                name: reqData.firstname + ' ' + reqData.lastname,
                from: '"Robomq" <' + config.smtp.from + '>', // sender address
                to: reqData.email, // list of receivers
                bcc: config.smtp.bcc,
                sales_email:config.sales_email,
                subject: 'Congratulations on your free trial of Connect!', // Subject line
                vrifyURL: vrifyURL,
                text: emailText, // plain text body
                html: path.join(__dirname, 'emails/registration/html') // html body
            };
            module.exports.sendMail(mailOptions, function (err, result) {
                if (err) {
                    logger.error("error in sending email>>>" + err);
                    reject(err);
                }
                else {
                    resolve(result);
                }
            });
        });

    },
    socialregisterEmail: function (reqData) {
        logger.info("create social register email content in method: socialregisterEmail, file:function");
        return new Promise(function (resolve, reject) {
        let mailOptions = {
                name: reqData.firstname + ' ' + reqData.lastname,
                from: 'Robomq <' + config.smtp.from + '>', // sender address
                to: reqData.mail, // list of receivers
                bcc: config.smtp.bcc,
                sales_email:config.sales_email,
                subject: 'Congratulations on your free trial of Connect!', // Subject line
                html: path.join(__dirname, 'emails/socialregistration/html') // html body
            };
            module.exports.sendMail(mailOptions, function (err, result) {
                if (err) {
                    logger.error("error in sending email>>>" + err);
                    reject(err);
                }
                else {
                    resolve(result);
                }
            });
        });

    },
    libeliumInstructionsMail: function (reqData1) {


        logger.info("Sending Libelium Instructions mail : libeliumInstructionsMail, file:function");
        return new Promise(function (resolve, reject) {


            let mailOptions = {

                from: '"Robomq" <' + config.smtp.from + '>', // sender address
                to: reqData1.to, // list of receivers
                cc: reqData1.uid,
                subject: 'Meshlium Gateway Setup', // Subject line
                company: reqData1.company,
                uid: reqData1.uid,
                firstname: reqData1.firstname,
                text: 'Meshlium Gateway Setup', // plain text body
                html: path.join(__dirname, 'emails/libelium/libeliumEmail') // html body
            };
            module.exports.sendMailForLibelium(mailOptions, function (err, result) {

                if (err) {
                    logger.error("error in sending email>>>" + err);
                    reject(err);
                }
                else {
                    resolve(result);
                }
            });
        });

    },
    libeliumPasswordMail: function (reqData1) {

        logger.info("Email ID of user with which he is logged in:  ",reqData1.uid);
        logger.info("Sending Libelium Password mail  method: libeliumPasswordMail, file:function");
        return new Promise(function (resolve, reject) {


            let mailOptions = {

                from: reqData1.uid, // sender address
                to: config.libeliumOperationsMail,
                subject: 'Password request', // Subject line
                company: reqData1.company,
                uid: reqData1.uid,
                firstname: reqData1.firstname,
                text: 'Password request', // plain text body
                html: path.join(__dirname, 'emails/libelium/libeliumPassword') // html body
            };
            module.exports.sendMailForLibelium(mailOptions, function (err, result) {

                if (err) {
                    logger.error("error in sending email>>>" + err);
                    reject(err);
                }
                else {
                    resolve(result);
                }
            });
        });

    },

    /*** Send Mail function only for Libelium*/

    sendMailForLibelium: function (inputData, callback) {

        logger.info("sending email content in method: sendMail, file:function");
        //callback(false);
        var nodemailer = require('nodemailer');
        const Email = require('email-templates');
        /** create transporter which configure the smtp detail */
        var transporter = nodemailer.createTransport({
            host: config.smtp.server,
            port: config.smtp.port,
            secure: false,
            service: 'gmail',
            auth: {
                user: config.smtp.login,
                pass: config.smtp.password,
            },
            debug: true
        });
        // fromEmail = 'Robomq <' + config.smtp.from + '>';

        const email = new Email({
            message: {
                from: inputData['from']
            },
            // uncomment below to send emails in development/test env:
            // send: true,
            transport: {
                jsonTransport: true
            },
            views: {
                options: {
                    extension: 'ejs' // <---- HERE
                }
            }
        });
        email
            .render(inputData['html'], {
                data: inputData,
                siteurl: config.siteurl
            })
            .then((results) => {
                /**  without attachement in the email */
                transporter.sendMail({
                    from: inputData['from'],
                    to: inputData['to'],
                    cc: inputData['cc'],
                    subject: inputData['subject'],
                    html: results,

                }, function (error) {
                    if (error) {
                        logger.error("error in sending email- sendMail function>>>>>>" + JSON.stringify(error));
                        callback(true, "email sending fail. Error:" + error.message);
                    } else {
                        logger.info("email send")
                        callback(null, "Email send successfully.");
                        // reject(results)
                    }
                });
            })
            .catch(error => {
                logger.error("error in rendering email templates- sendMail fun>>>>>" + JSON.stringify(error))
                callback(true, "email sending fail. Error:" + error.message);
                // resolve(error)
            })

    },
    /** common function to send email from node server */
    sendMail: function (inputData, callback) {

        logger.info("sending email content in method: sendMail, file:function");
        logger.info("sending email inputData>>>"+JSON.stringify(inputData));
        //callback(false);
        var nodemailer = require('nodemailer');
        const Email = require('email-templates');
        /** create transporter which configure the smtp detail */
        var transporter = nodemailer.createTransport({
            host: config.smtp.server,
            port: config.smtp.port,
            secure: false,
            service: 'gmail',
            auth: {
                user: config.smtp.login,
                pass: config.smtp.password,
            },
            debug: true
        });
        // fromEmail = 'Robomq <' + config.smtp.from + '>';

        const email = new Email({
            message: {
                from: inputData['from']
            },
            // uncomment below to send emails in development/test env:
            // send: true,
            transport: {
                jsonTransport: true
            },
            views: {
                options: {
                    extension: 'ejs' // <---- HERE
                }
            }
        });
        email
            .render(inputData['html'], {
                data: inputData,
                siteurl: config.siteurl
            })
            .then((results) => {
                /**  without attachement in the email */
                transporter.sendMail({
                    from: inputData['from'],
                    to: inputData['to'],
                    bcc: inputData['bcc'],
                    subject: inputData['subject'],
                    html: results,

                }, function (error) {
                    if (error) {
                        logger.error("error in sending email- sendMail function>>>>>>" + JSON.stringify(error));
                        callback(true, "email sending fail. Error:" + error.message);
                    } else {
                        logger.info("email send")
                        callback(null, "Email send successfully.");
                        // reject(results)
                    }
                });
            })
            .catch(error => {
                logger.error("error in rendering email templates- sendMail fun>>>>>" + JSON.stringify(error))
                callback(true, "email sending fail. Error:" + error.message);
                // resolve(error)
            })

    },

    /** send reset password on registered email when user request through forgot password page */
    resetPasswordEmail: function (reqData) {
        logger.info("create email with reset password instruction in method: resetPasswordEmail, file:function");
        return new Promise(function (resolve, reject) {
            var nodemailer = require('nodemailer');
            const Email = require('email-templates');
            /** create transporter which configure the smtp detail */
            var transporter = nodemailer.createTransport({
                host: config.smtp.server,
                port: config.smtp.port,
                secure: false,
                service: 'gmail',
                auth: {
                    user: config.smtp.login,
                    pass: config.smtp.password,
                },
                debug: true
            });
            var fullname = reqData.cn + ' ' + reqData.sn;

            let timestampRegister = reqData.currentTime; //new Date().getTime();
            var convertString = reqData.uid + timestampRegister;
            var hashValue = module.exports.createhash(convertString);

            var verifyURL = config.siteurl + "resetpassword/" + hashValue + "/" + reqData.uid;


            let mailOptions = {
                name: fullname,
                from: '"Robomq" <' + config.smtp.from + '>', // sender address
                to: reqData.uid, // list of receivers
                bcc: config.smtp.bcc,
                sales_email:config.sales_email,
                subject: 'Reset your account password', // Subject line
                username: reqData.uid,
                password: reqData.userPassword,
                verifyURL: verifyURL, // plain text body
                html: path.join(__dirname, 'emails/resetpassword/html') // html body
            };
            module.exports.sendMail(mailOptions, function (err, result) {
                if (err) {
                    logger.error("resetpasswordEmail email error>>>" + err);
                    reject(err);
                }
                else {
                    resolve(result);
                }
            });
        });

    },
    /** send user account credentials on successfull account verification */
    sendPasswordEmail: function (reqData) {
        logger.info("create email with user credential in method: sendPasswordEmail, file:function");
        return new Promise(function (resolve, reject) {
            var nodemailer = require('nodemailer');
            const Email = require('email-templates');
            /** create transporter which configure the smtp detail */
            var transporter = nodemailer.createTransport({
                host: config.smtp.server,
                port: config.smtp.port,
                secure: false,
                service: 'gmail',
                auth: {
                    user: config.smtp.login,
                    pass: config.smtp.password,
                },
                debug: true
            });
            var fullname = reqData.cn + ' ' + reqData.sn;

            let timestampRegister = reqData.currentTime; //new Date().getTime();
            var convertString = reqData.uid + timestampRegister;
            var hashValue = module.exports.createhash(convertString);

            var verifyURL = config.siteurl + "resetpassword/" + hashValue + "/" + reqData.uid;


            let mailOptions = {
                name: fullname,
                from: '"Robomq" <' + config.smtp.from + '>', // sender address
                to: reqData.uid, // list of receivers
                bcc: config.smtp.bcc,
                sales_email:config.sales_email,
                subject: 'Your Connect account credential', // Subject line
                username: reqData.uid,
                password: reqData.userPassword,
                html: path.join(__dirname, 'emails/sendpassword/html') // html body
            };
            module.exports.sendMail(mailOptions, function (err, result) {
                if (err) {
                    logger.error("email error sendPasswordEmail fun>>>", err);
                    reject(err);
                }
                else {
                    resolve(result);
                }
            });
        });

    },
    /** Promises for ldap function like searchUser, createnewUser, deleteUser, modifyUser */
    serchUser: function (client, startDN, parameters) {
        logger.info("searching user in ldap in method: serchUser, file:function");
        return new Promise(function (resolve, reject) {
            // Do async job
            var found = false;
            var searchResults = [];
            client.search(startDN, parameters, function (err, res1) {

                res1.on('searchEntry', function (entry) {
                    // Add the search results to the array
                    searchResults.push(entry.object);
                    found = true;
                    //resolve(entry.object);
                });

                res1.on('searchReference', function (referral) {
                    logger.info('searchser promise referral: ' + referral.uris.join());
                    resolve(referral);
                });

                res1.on('error', function (err) {
                    logger.error("searchuser promise error >>" + JSON.stringify(err));
                    reject(err.message);
                });
                res1.on('end', function (result) {
                    resolve(searchResults);
                });
            })
        })
    },
    /**create new user in hubspot */
    createHubspotContact:async function(data){
        console.info("publishing this data for creating contact in hubspot ",data);
    const username_deploy = config["amqpstats"]["username"];
    const password_deploy = config["amqpstats"]["password"];
    const host_deploy = config["amqpstats"]["host"];
    const ssl_deploy = config["amqpstats"]["ssl"];
    const vhost_deploy = config["amqpstats"]["vhost"];
    const exchange_deploy = config["amqpstats"]["exchange"];
    const routingkey = config["amqpstats"]["routingkey"];
    const heartbeat = config["amqpstats"]["heartbeat"];
    let currentConn;
    let amqp_url;
    if (ssl_deploy) {
        amqp_url = "amqps://" + username_deploy + ":" + password_deploy + "@" + host_deploy + ":5671/" + vhost_deploy + "?heartbeat="+heartbeat
    } else {
        amqp_url = "amqp://" + username_deploy + ":" + password_deploy + "@" + host_deploy + ":5672/" + vhost_deploy + "?heartbeat="+heartbeat
    }

   
   
    console.info("amqp_url is ",amqp_url)

     amqp.connect(amqp_url)
        .then(function (conn) {
            currentConn = conn;
            //console.log("here ia am ")
            return conn.createConfirmChannel();
        })
        .then(function (ch) {
            return ch.assertQueue(routingkey)
                .then(() => ch.assertExchange(exchange_deploy, 'topic'))
                .then(() => ch.bindQueue(routingkey, exchange_deploy, routingkey))
                .then(() => {
                    ch.sendToQueue(routingkey,Buffer.from(data));
                    console.log("success")
                    return "success";
                })
                .catch(error => {
                    console.error("connection failure", error)
                    //res.send({ "message": "error" });
                    return "Some error occured while publishing in queue : "+JSON.stringify(error);
                    currentConn.close();
                })
        })
        .catch(error => {
            console.error("connection failure", error)            
            // res.send({ "message": "error" });
            return "Some error occured while publishing in queue : "+JSON.stringify(error);
            if (currentConn != undefined) {
                currentConn.close();
            }
        })

    },
    /**create new user in ldap */
    createNewUser: function (client, dnData, entryData) {
        logger.info("create new user in ldap in method: createNewUser, file:function");

        logger.info(`data with object ${JSON.stringify(entryData)}`);
        // Setting URL and headers for request
        // Return new promise 
        return new Promise(function (resolve, reject) {
            // Do async job
            client.add(dnData, entryData, function (err, body) {
                if (err) {
                    reject(err);
                } else {
                    resolve(body);
                }
            })
        })
    },
    /**delete user from ldap */
    deleteUser: function (client, dnData) {
        logger.info("delete user from ldap in method: deleteUser, file:function");
        // Setting URL and headers for request
        // Return new promise 
        return new Promise(function (resolve, reject) {
            // Do async job

            client.del(dnData, function (err, body) {
                if (err) {
                    logger.error('Error in delete user from ldap--->' + err);
                    reject(err);
                } else {
                    resolve(body);
                }
            })
        })
    },
    /**modify user info in ldap */
    modifyUser: function (client, dnData, entryData) {
        logger.info("modify user info in ldap in method: modifyUser, file:function");
        return new Promise(function (resolve, reject) {
            client.modify(dnData, entryData, function (err, body) {
                if (err) {
                    logger.error('Error in modify user in ldap--->' + err);
                    reject(err);
                } else {
                    resolve(body);
                }

            });
        });
    },
    /** Promises part end here */

    generatePassword: function (vhostname) {
        logger.info("generate a password in method: generatePassword, file:function");
        const crypto = require('crypto');

        let msgString = vhostname.toLowerCase();
        let SECRET = config.secret;//new Date().getTime();
        // signature = crypto.createHmac('sha256', SECRET).update(message).digest('hex').toUpperCase()


        let password = crypto.createHmac('sha1', SECRET.toString()).update(msgString).digest('hex');

        // password = base64.b64encode(hmac.new(str(vhostname), str(
        //     time.time()), digestmod=hashlib.sha1).digest())
        // # Replace the AMQP URI reserved characters with their hexadecimal ASCII
        // # code
        password = password.replace("/", "2F")
        password = password.replace("@", "40")
        password = password.replace(":", "3A")
        password = password.replace("?", "3F")
        password = password.replace("+", "2B")

        logger.info('tenant admin: ' + vhostname + ', password: ' + password);
        return password;
    },
    makeRequest: function (options) {
        logger.info("make request with request module in method: makeRequest, file:function");
        var request = require('request');
        // Setting URL and headers for request
        // Return new promise 
        return new Promise(function (resolve, reject) {
            // Do async job
            request(options, function (error, response, body) {
                if (!error) {
                    resolve(body);
                } else {
                    if (response !== undefined && (response.statusCode == 404 || response.statusCode == 204)) {
                        resolve(error);
                    }
                    else {
                        reject(error);
                    }

                }
            })
        })
    },
    getUniqueUser: function (username) {
        logger.info("generate a password in method: generatePassword, file:function");
        return new Promise(function (resolve, reject) {
            module.exports.checkvhost(username)
                .then(function (response) {
                    let jsonResult = JSON.parse(response);
                    if (jsonResult.name != undefined) {
                        let random = module.exports.generate(4)
                        newusername = username + random;
                        module.exports.getUniqueUser(newusername)
                            .then(function (data) {
                                resolve(data);
                            })
                            .catch(function (err) {
                                logger.error("err" + err);
                                reject(err);
                            })
                    }
                    else {
                        resolve(username);
                    }
                })
                .catch(function (err) {
                    logger.error("err" + err);
                    reject(err);
                })
        });


    },
    /** Functions related to rabbitmq broker management UI */
    checkvhost: function (username) {
        logger.info("checking vhost on broker in method: checkvhost, file:function");
        let provisionconfigData = config.amqpstats;
        var newusername = '';
        /** 
         * For Broker Creds
         */
        // radmin = provisionconfigData["amqpstats"]["admin"]
        // rpass = provisionconfigData["amqpstats"]["password"]
        // robomq = provisionconfigData["amqpstats"]["rabbit"]
        return new Promise(function (resolve, reject) {

            query = provisionconfigData.brokerURLwithCredentials + "/api/users/" + username;
            var options = {
                method: 'GET',
                url: query,
                headers: {
                    'content-type': 'application/json',
                }
            };
            request(options, function (error, response, body) {
                if (!error && response.statusCode == 200) {
                    reject(body);
                } else {
                    if (response != undefined && (response.statusCode == 404 || response.statusCode == 204)) {
                        resolve(response.statusCode);
                    }
                    else {
                        reject(error);
                    }

                }
            })

        });

    },
    deletevhostUser: function (username, password) {
        logger.info("deleting vhost on broker in method: deletevhostUser, file:function");
        let provisionconfigData = config.amqpstats;

        // radmin = provisionconfigData["amqpstats"]["admin"]
        // rpass = provisionconfigData["amqpstats"]["password"]
        // robomq = provisionconfigData["amqpstats"]["rabbit"]

        const data = {
            'password': password,
            'tags': 'policymaker'
        };
        var options = {
            url: provisionconfigData.brokerURLwithCredentials + "/api/users/" + username,
            headers: {
                'content-type': 'application/json'
            },
            method: 'DELETE',
            json: data
        };
        return new Promise(function (resolve, reject) {
            request(options, function (err, resp, body) {
                if (err) {
                    logger.error('error occured while delete vhost... ' + err);
                    reject(err);
                } else {
                    logger.info('succeded in deleting user...');
                    logger.info('status code for deleting is :   ' + resp['statusCode']);
                    resolve(JSON.stringify(resp));
                }
            });
        });
    },
    createVhost: function (vhostname, username, provisioningPassword) {
        logger.info("create new vhost and user on broker in method: createVhost, file:function");
        let provisionconfigData = config.amqpstats;

        // password = module.exports.generatePassword(vhostname);

        logger.info('in function createVhost');
        /** 
         * For Broker Creds
         */
        // radmin = provisionconfigData["amqpstats"]["admin"]
        // rpass = provisionconfigData["amqpstats"]["password"]
        // robomq = provisionconfigData["amqpstats"]["rabbit"]

        return new Promise(function (resolve, reject) {

            /** create vhost  */
            vhostQuery = provisionconfigData.brokerURLwithCredentials + "/api/vhosts/" + vhostname;
            var vhostOptions = {
                method: 'PUT',
                url: vhostQuery,
                headers: {
                    'content-type': 'application/json',
                }
            };
            module.exports.makeRequest(vhostOptions)
                .then(function (result) {
                    logger.info("success of create vhost");
                    /** set permissions for admin over every vhost  */
                    query = provisionconfigData.brokerURLwithCredentials + "/api/permissions/" + vhostname + "/" + provisionconfigData.radmin;

                    var options = {
                        method: 'PUT',
                        url: query,
                        headers: [{
                            'content-type': 'application/json',
                        }],
                        json: {
                            "scope": "client",
                            "configure": ".*",
                            "write": ".*",
                            "read": ".*"
                        }
                    };
                    module.exports.makeRequest(options)
                        .then(function (permissionRes) {
                            /** create user */

                            userQuery = provisionconfigData.brokerURLwithCredentials + "/api/users/" + username;
                            var userOptions = {
                                method: 'PUT',
                                url: userQuery,
                                headers: {
                                    'content-type': 'application/json',
                                },
                                json: { "password": provisioningPassword, "tags": "policymaker" }
                            };
                            module.exports.makeRequest(userOptions)
                                .then(function (userRes) {

                                    /** add tags and set permissions for user over vhost */
                                    logger.info("permission user-->");
                                    var permissionOptions = {
                                        method: 'PUT',
                                        url: provisionconfigData.brokerURLwithCredentials + "/api/permissions/" + vhostname + "/" + username,
                                        headers: { 'content-type': 'application/json' },
                                        json: {
                                            "scope": "client",
                                            "configure": ".*",
                                            "write": ".*",
                                            "read": ".*"
                                        }
                                    };
                                    module.exports.makeRequest(permissionOptions)
                                        .then(function (permissionResult) {
                                            resolve(permissionResult)
                                        })
                                        .catch(function (permissionError) {
                                            logger.error("PermissionError for User over vhost>>" + JSON.stringify(permissionError));
                                            reject(permissionError)
                                        })
                                })
                                .catch(function (userErr) {
                                    logger.error("Create user error over vhost>>>" + JSON.stringify(userErr));
                                    reject(userErr)
                                })
                        })
                        .catch(function (permissionErr) {
                            logger.error("permissionErr for vhost>>>" + JSON.stringify(permissionErr));
                            reject(permissionErr);
                        })
                })
                .catch(function (error) {
                    logger.error("vhost create error>>>" + JSON.stringify(error));
                    reject(error)
                })

        });

    },
    /** delete user from redis database
     * First found the key with organization name
     * then find username in user array 
     * delete the index from user array and update the user object again
     */
    deleteRedisUser: function (uid) {
        logger.info("delete user from redis in method: deleteRedisUser, file:function");
        return new Promise(function (resolve, reject) {
            const data = uid.split('@');
            const customeKey = data[1] + ":profile";

            module.exports.getKey(customeKey)
                .then(result => {
                    if (result !== null) {
                        const jsObj = JSON.parse(result);
                        const orgUsers = jsObj['user'];
                        const orgName = jsObj['name'];
                        for (var i = 0; i < jsObj['user'].length; i++) {
                            if (jsObj['user'][i]['username'] == uid) {
                                // userProfile=profile['user'][i];
                                // delete orgUsers[i];
                                orgUsers.splice(i, 1);
                                break;
                            }
                        }
                        let info = new Object();
                        info['name'] = orgName;
                        info['user'] = orgUsers;
                        module.exports.setKey(customeKey, info)
                            .then((setkeyRes) => {
                                resolve(setkeyRes);
                            })
                            .catch((setkeyErr) => {
                                logger.error("deleteRedisUser setkeyErr>>>", setkeyErr);
                                reject(setkeyErr);
                            })
                    }
                    else {
                        resolve();
                    }

                })
                .catch(error => {
                    logger.error("error while searching in redis>>" + error);
                    reject(error);
                });
        });
    },

    /** delete keys from redis database of a user which is not exist in ldap
     * and user try to register with same email again.
     * we have to find all keys of different types, stored in redis for that user
     * and delete all keys from redis database.
     * 
     * not using right now...
     */
    /*deleteRedisUserData: async function (uid) {
        logger.info("delete user from redis in method: deleteRedisUser, file:function");

       
        const { promisify } = require('util');
        const sremAsync = promisify(rclient.srem).bind(rclient);
        const hlenAsync = promisify(rclient.hlen).bind(rclient);
        const getAsync = promisify(rclient.get).bind(rclient);
        const smembersAsync = promisify(rclient.smembers).bind(rclient);
        const saddAsync = promisify(rclient.sadd).bind(rclient);
        const hsetAsync = promisify(rclient.hset).bind(rclient);
        const hdelAsync = promisify(rclient.hdel).bind(rclient);
        const hgetallAsync = promisify(rclient.hgetall).bind(rclient);
        const hkeysAsync = promisify(rclient.hkeys).bind(rclient);
        const hgetAsync = promisify(rclient.hget).bind(rclient);
        const hexistsAsync = promisify(rclient.hexists).bind(rclient);
        const typeAsync = promisify(rclient.type).bind(rclient);
        

        return new Promise(function (resolve, reject) {
            const data = uid.split('@');
            const customeKey = `${data}.${uid}*`;
            let getKeys = await getAsync(customeKey);
            if(getKeys.length > 0){
                getKeys.forEach(element => {
                    getTypeOfKey = await typeAsync(element);
                    switch (getTypeOfKey) {
                        case 'zset':
                            
                            break;
                        case 'hash':
                        
                            break;
                        case 'string':
                        
                            break;

                        case 'set':
                        
                            break;

                        default:
                            break;
                    }  
                });
            }
            
        });
    },*/

    /** Function related to rabbitmq broker management UI end here */
    /** If any error occured at the time of user resgistration,
     * and user information not saved in one of database i.e
     *  provision( rabbitmq broker managment ui) or in redis database
     * then this function will call and revert back all the entries.
     * This is like Transaction.
     */
    rollbackUserRegistration: function (client, username) {
        logger.info("delete user inormation from ldap, broker and redis in method: rollbackUserRegistration, file:function");
        let ldapStartDN = config.ldapDetails.base;
        let attributes = "*";
        // Set filter for search
        ldapFilter = '(ou=' + username + ')';//filter.split(',');
        ldapAttributes = attributes.split(',');

        // Set the parameters for LDAP search
        let parameters = {
            filter: ldapFilter,
            scope: 'sub',
            attributes: ldapAttributes
        };
        return new Promise(function (resolve, reject) {
            module.exports.serchUser(client, ldapStartDN, parameters)
                .then((response) => {

                    let userData = response[0];
                    var deleteuserOUDN = userData['dn'];
                    var deleteUserDN = "uid=" + username + "," + deleteuserOUDN;
                    let userPassword = userData['userPassword'];

                    module.exports.checkvhost(username)
                        .then((responseVar) => {
                            if (responseVar == 404 || responseVar == 204) {
                                // var promise1 = module.exports.deletevhostUser(username, userPassword);
                                // var promise1 = module.exports.deleteRedisUser(username);
                                var promise2 = module.exports.deleteUser(client, deleteUserDN);
                                var promise3 = module.exports.deleteUser(client, deleteuserOUDN);


                                Promise.all([promise2, promise3]).then((executeRes) => {
                                    resolve(executeRes);
                                })
                                    .catch((executeErr) => {
                                        logger.error("executeErr in delete user from redis and ldap>>>", executeErr)
                                        reject(executeErr);
                                    })
                            }
                            else {
                                // var promise1 = module.exports.deleteRedisUser(username);
                                var promise2 = module.exports.deletevhostUser(username, userPassword);
                                var promise3 = module.exports.deleteUser(client, deleteUserDN);
                                var promise4 = module.exports.deleteUser(client, deleteuserOUDN);


                                Promise.all([promise2, promise3, promise4]).then((executeRes) => {
                                    resolve(executeRes);
                                })
                                    .catch((executeErr) => {
                                        logger.error("executeErr in delete user from redis, broker and ldap>>>", executeErr)
                                        reject(executeErr);
                                    });
                            }
                        })
                        .catch((errorVar) => {
                            logger.error("error in checking vhost>>>", errorVar);
                            // var promise1 = module.exports.deleteRedisUser(username);
                            var promise2 = module.exports.deletevhostUser(username, userPassword);
                            var promise3 = module.exports.deleteUser(client, deleteUserDN);
                            var promise4 = module.exports.deleteUser(client, deleteuserOUDN);

                            Promise.all([ promise2, promise3, promise4]).then((executeRes) => {
                                resolve(executeRes);
                            })
                                .catch((executeErr) => {
                                    logger.error("Error whiel running promise to delete user entry>>>" + executeErr)
                                    reject(executeErr);
                                });
                        })
                })
                .catch((Error) => {
                    reject(Error);
                })
        });

    },
    /** 
     * This Function get the businesscategory value for related domain from config file
     * businesscategory.json 
     * @param {String} domain: name of vhost underwhich user perform registration. 
     */
    getBusinessCategoryByDomain: function(domain){
        /** load businesscategory config */
        const businessCategory = require('./config/businesscategory.json');
        /** get account mapping data */
        let accountMap = businessCategory.accountMapping;
        
        /** getting businesscategory from accountmap object for domain */
        let filteredObj = accountMap.find(function(item, i){
            
            if(domain in item){
                let domainVal = item[domain];
                return domainVal;
                //break;
            }
        });
        let userbusinessCategory = "";
        logger.info(`filteredObj : ${JSON.stringify(filteredObj)}`);
        if(filteredObj != undefined){
            userbusinessCategory = filteredObj[domain];
        } 
        else{
            userbusinessCategory ="free";
        }
        return userbusinessCategory;
    }
}


