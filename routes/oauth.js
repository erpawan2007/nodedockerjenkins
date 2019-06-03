const express = require('express');
const router = express.Router();
var passport = require('passport')
    , OutlookStrategy = require('passport-outlook').Strategy;

let GoogleStrategy = require('@passport-next/passport-google-oauth2').Strategy;
const config = require('../config/config.json');
const FUNCTION = require('../function.js');
const base64url = require('base64url');
const ldapStartDN = config.ldapDetails.base;
const ldap = require('ldapjs');
const failureRedirectURL = config.siteurl + "login";
const gmailCallback = config.siteurl + config.frontProxy + "auth/callback/Gmail";
const outlookCallback = config.siteurl + config.frontProxy + "auth/callback/Outlook";

/** businesscategory config */
const businessCategory = require('../config/businesscategory.json');

// Passport session setup.
//   To support persistent login sessions, Passport needs to be able to
//   serialize users into and deserialize users out of the session.  Typically,
//   this will be as simple as storing the user ID when serializing, and finding
//   the user by ID when deserializing.  However, since this example does not
//   have a database of user records, the complete Outlook profile is
//   serialized and deserialized.
passport.serializeUser(function (user, done) {
    done(null, user);
});

passport.deserializeUser(function (obj, done) {
    done(null, obj);
});


// dynamically create the callback url if the URI is not undefined

router.use(async function (req, res, next) {
    var ecosystem;
    var callback_url;

    if (!req.url.includes("callback")) {
        let host = req.get("HOST");
        var my_string = req.url.split("/");

        ecosystem = my_string[1].substring(0, my_string['1'].indexOf('?'));

        let uri_prefix = req.query.prefix;
        let final_uri = config.frontProxy + "/auth/callback/" + ecosystem;


        if (host === 'localhost:4200') {
            callback_url = "http://" + host + uri_prefix + final_uri;
        } else {
            callback_url = "https://" + host + uri_prefix + final_uri;
        }

        prefix = uri_prefix;
        req.uri_prefix = uri_prefix;
        req.callback_url = callback_url;
    }
    next();
});
router.use(passport.initialize());
router.use(passport.session());

passport.use(new GoogleStrategy({
    clientID: config.Gmail.client_id,
    clientSecret: config.Gmail.client_secret,
    callbackURL: gmailCallback,
    passReqToCallback: true
},
    function (request, accessToken, refreshToken, profile, done) {
        process.nextTick(function () {
            // the user's Outlook profile is returned
            // to represent the logged-in user.  In a typical application, you would
            // want to associate the Outlook account with a user record in your
            // database, and return that user instead.
            return done(null, profile);
        });
    }
));

passport.use(new OutlookStrategy({
    clientID: config.Outlook.client_id,
    clientSecret: config.Outlook.client_secret,
    callbackURL: outlookCallback
},
    function (accessToken, refreshToken, profile, done) {
        // asynchronous verification, for effect...
        process.nextTick(function () {

            // To keep the example simple, the user's Outlook profile is returned
            // to represent the logged-in user.  In a typical application, you would
            // want to associate the Outlook account with a user record in your
            // database, and return that user instead.
            // console.log(profile);
            return done(null, profile);
        });
    }
));



// array to hold logged in users




/* Passport strategy for Gmail */
router.get('/Gmail', function (req, res, next) {
    let state = generate_state(req);
    passport.authenticate('google', {
        scope: config.Gmail.scope,
        prompt: 'select_account',
        accessType: 'offline',
        state: state,
        failureRedirect: failureRedirectURL
    })(req, res, next);
    // next();
});

/** callback url */
router.get('/callback/Gmail', passport.authenticate('google', { failureRedirect: failureRedirectURL }),
    function (req, res) {
        var restrictedDomains = config.restrictedDomains;
        let state = JSON.parse(base64url.decode(req.query.state));
        var key = state.vhost + ":profile";
        let uri_prefix = state["uri_prefix"];
        let host = req.get("HOST");
        let final_uri = "sociallogin"
        if (host === 'localhost:4200') {
            callback_url = "http://" + host + uri_prefix + final_uri;
        } else {
            callback_url = "https://" + host + uri_prefix + final_uri;
        }
        // console.log("google req data>>>",req);
        // logger.info("google req conact>>>"+req.phonenumbers);
        // logger.info("google user data>>>"+JSON.stringify(req.user));
        let socailID = req.user.id;
        var ecosystem = req.params.ecosystem;
        var employeeType = 'google';
        var profileData = req.user._json;
        let email = profileData.email.toLowerCase();
        logger.info("user profile  data>>>" + JSON.stringify(profileData));
        /**split email with "@" */
        let fetchEmailpart = email.split('@');
        /** split the string again with "." and fetch the domain name of email */
        getDomainName = fetchEmailpart[1].split('.');
        if (restrictedDomains.includes(getDomainName[0])) {
            // res.status(401).send({"message":"Sorry, currently we accept only corporate account!"})
            res.redirect(failureRedirectURL + "?account=gmail");
        }
        else {
            // var googleUserData = req.user['_json'];
            let fullname = profileData.name.split(' ');
            let firstname = fullname[0];
            let lastname = fullname[1];
            let getCompany = email.split('@');
            let companyName = getCompany[1];
            var companyNameValue = "";

            let vhost = companyName;
            const companyDN = "o=" + companyName + "," + ldapStartDN;
            const technoDN = "ou=technology,o=" + companyName + "," + ldapStartDN;
            const uuidDN = "ou=" + email + "," + technoDN;
            const uidDN = "uid=" + email + "," + uuidDN;

            FUNCTION.createClient()
                .then((client) => {
                    var attributes = "*";
                    ldapFilter = '(uid=' + email + ')';//filter.split(',');
                    ldapAttributes = attributes.split(',');
                    // Set the parameters for LDAP search
                    var parameters = {
                        filter: ldapFilter,
                        scope: 'sub',
                        attributes: ldapAttributes
                    };
                    logger.info("searching user with ldapStartDN=" + ldapStartDN + ", parameters=" + JSON.stringify(parameters));
                    FUNCTION.serchUser(client, ldapStartDN, parameters)
                        .then(function (searchResults) {
                            /** if searchResults is empty than create a new entry in following:
                             * 1: Ldap
                             * 2. Broker
                             * 3. Redis
                             */

                            if (searchResults.length == 0) {
                                let userEmail = email;
                                let provisioningPassword = FUNCTION.generate(8);
                                /**
                                 * creating insertdata for each DN
                                 */
                                const entry1 = {
                                    objectclass: ['organization'],
                                    o: companyName
                                };
                                const entry2 = {
                                    objectclass: ['organizationalUnit'],
                                    ou: 'technology'
                                };

                                /**
                                 * get busines category from businesscategory config
                                 */
                                let userbusinessCategory = FUNCTION.getBusinessCategoryByDomain(vhost);

                                const entry3 = {
                                    objectclass: ['organizationalUnit'],
                                    ou: userEmail,
                                    businessCategory: userbusinessCategory,
                                    userPassword: provisioningPassword
                                };

                                /**
                                 * Data type and values we are using
                                 *
                                 * employeeType: accountType (google,o365, ldap)
                                 * initials: accountStatus ('t', 'f')
                                 * title: primaryAccount ('primary', 'secondary')
                                 * employeeNumber: timestamp
                                 */
                                let initials = 't';

                                let timestampRegister = new Date().getTime();
                                var company = companyName.split('.');
                                // entry4['o']=company[0];
                                if (company[0] != 'gmail') {
                                    companyNameValue = company[0];
                                }
                                else {
                                    companyNameValue = 'N/A';
                                }

                                let entry4 = {
                                    cn: firstname,
                                    sn: lastname,
                                    mail: email,
                                    objectclass: ['inetOrgPerson'],
                                    uid: email,
                                    employeeType: employeeType,
                                    title: "primary",
                                    initials: initials,
                                    employeeNumber: timestampRegister,
                                    l: socailID,
                                    o: companyNameValue
                                };
                                /** [CU-626] Create Hubspot Contact  */
                                let hubspotContact = {
                                    method: "create",
                                    firstName: firstname,
                                    lastName: lastname,
                                    email: email,
                                    company: companyNameValue,
                                    phone: "",
                                    LeadStatus: "Connect Trial"
                                }
                                /** [CU-626] Create Hubspot Contact END */


                                FUNCTION.createNewUser(client, companyDN, entry1)
                                    .catch(function (errorHandler) {

                                        if (errorHandler.name.indexOf('EntryAlreadyExistsError') > -1) {
                                            logger.info('No worries as the organization already exists>>' + errorHandler.name);
                                            return;
                                        }
                                        else {
                                            logger.error("Error while creating organization>>>" + errorHandler);
                                            var myObj = new Object();
                                            myObj['message'] = "Some error occured while creating organization.";
                                            // let redirectURL = callback_url+"?sinMarker="
                                            res.redirect(failureRedirectURL);
                                        }

                                    })
                                    .then((val) => {
                                        /**
                                         * creating a organization unit under Organization
                                         */

                                        FUNCTION.createNewUser(client, technoDN, entry2)
                                            .catch(function (errorHandler) {
                                                if (errorHandler.name.indexOf('EntryAlreadyExistsError') > -1) {
                                                    logger.info('No worries as the organization Unit already exists.' + errorHandler.name);
                                                    return;
                                                }
                                                else {
                                                    logger.error("Error while creating organization unit>>>" + errorHandler);
                                                    var myObj = new Object();
                                                    myObj['message'] = "Some error occured while creating organization unit." + errorHandler.name;
                                                    // let redirectURL = callback_url+"?sinMarker="
                                                    res.redirect(failureRedirectURL);
                                                }
                                            })
                                            .then((result) => {
                                                /**
                                                 * creating a dynamic UUID for new User
                                                 */

                                                FUNCTION.createNewUser(client, uuidDN, entry3)
                                                    .catch(function (errorHandler) {
                                                        var myObj = new Object();
                                                        myObj['message'] = "Some error occured while creating UUID. Error name: " + errorHandler.name;
                                                        logger.error(myObj['message']);
                                                        res.redirect(failureRedirectURL);
                                                    })
                                                    .then((result) => {
                                                        /**
                                                         * Insert User information under the UUID
                                                         */

                                                        FUNCTION.createNewUser(client, uidDN, entry4)
                                                            .then(finalres => {
                                                                /**
                                                                 * we have to send an email after user inserted in ldap
                                                                 */
                                                                FUNCTION.checkvhost(userEmail)
                                                                    .then(function (result) {

                                                                        FUNCTION.createVhost(vhost, userEmail, provisioningPassword)
                                                                            .then(function (createRes) {
                                                                                /** add user information in Redis database */

                                                                                var newparameters = {
                                                                                    filter: '(uid=*)',
                                                                                    scope: 'sub',
                                                                                    attributes: ['*']
                                                                                };
                                                                                var myObj = new Object();
                                                                                FUNCTION.serchUser(client, uuidDN, newparameters)
                                                                                    .then(function (result) {
                                                                                        user = result[0];
                                                                                        var attr = user.dn.split(",");

                                                                                        /**
                                                                                         * split DN on first occureence of comma
                                                                                         * it will remove the uid from dn string
                                                                                         */
                                                                                        var ousearchDN = user.dn.split(/,(.+)/)[1];
                                                                                        var ouparameters = {
                                                                                            filter: '(ou=' + user.uid + ')',
                                                                                            scope: 'sub',
                                                                                            attributes: ['*']//['uid','sn','cn','mail', 'mobile', 'employeeType', 'title']
                                                                                        };
                                                                                        logger.info("Searching user OU information with ousearchDN=" + ousearchDN + ", ouparameters=" + JSON.stringify(ouparameters))
                                                                                        FUNCTION.serchUser(client, ousearchDN, ouparameters)
                                                                                            .then(function (entry) {
                                                                                                let ouDetail = entry[0];
                                                                                                for (i = 0; i < attr.length; i++) {

                                                                                                    // check for organization
                                                                                                    if (attr[i].indexOf("o=") > -1) {
                                                                                                        var temp = attr[i].split("=");
                                                                                                        myObj.o = temp[1];
                                                                                                    }

                                                                                                    // check for organization unit
                                                                                                    if (attr[i].indexOf("ou=") > -1) {

                                                                                                        var temp = attr[i].split("=");
                                                                                                        myObj.uuid = temp[1];
                                                                                                        attr.splice(i, 1);
                                                                                                    }
                                                                                                    if (attr[i].indexOf("ou=") > -1) {

                                                                                                        var temp = attr[i].split("=");
                                                                                                        myObj.ou = temp[1];
                                                                                                    }

                                                                                                    // check for user Id
                                                                                                    if (attr[i].indexOf("uid=") > -1) {
                                                                                                        var temp = attr[i].split("=");
                                                                                                        myObj.uid = temp[1];
                                                                                                    }
                                                                                                }
                                                                                                let vhost = user.mail.split('@');
                                                                                                myObj.firstname = user.cn;
                                                                                                myObj.lastname = user.sn;
                                                                                                myObj.mobile = user.mobile;
                                                                                                myObj.mail = user.mail;
                                                                                                myObj.status = user.initials;
                                                                                                myObj.vhost = vhost[1];
                                                                                                myObj.company = user.o;
                                                                                                myObj.memberOf = user.employeeType;
                                                                                                myObj.bussiness_category = ouDetail['businessCategory'];

                                                                                                sess = req.session;
                                                                                                sess.username = user.uid;
                                                                                                sess.o = myObj.o;
                                                                                                sess.ou = myObj.ou;
                                                                                                sess.uid = myObj.uid;
                                                                                                sess.vhost = vhost[1];
                                                                                                sess.broker_password = ouDetail['userPassword'];
                                                                                                sess.bussiness_category = ouDetail['businessCategory'];
                                                                                                sess.session_id = req.sessionID;

                                                                                                myObj.sessionId = sess.session_id;
                                                                                                /** added line
                                                                                                 * creating redis key for storing multiple session id of same user
                                                                                                 * key pattern "sessions:pawan@mailinator.com"
                                                                                                 */
                                                                                                rclient.sadd("sessions:" + myObj.uid, "sess:" + req.sessionID);
                                                                                                /** end */

                                                                                                /** [CU-626] Create Hubspot Contact  */
                                                                                                FUNCTION.createHubspotContact(JSON.stringify(hubspotContact))
                                                                                                    .then((createContactRes) => {
                                                                                                        logger.info('createContactRes>>' + createContactRes);
                                                                                                    })
                                                                                                    .catch((createContactErr) => {
                                                                                                        logger.info('createContactErr>>' + createContactErr);
                                                                                                    });
                                                                                                /** [CU-626] Create Hubspot Contact END */

                                                                                                FUNCTION.socialregisterEmail(myObj)
                                                                                                    .then((emailRes) => {
                                                                                                        logger.info("email sent");
                                                                                                    })
                                                                                                    .catch((emailErr) => {
                                                                                                        logger.error("email not sent");
                                                                                                    });

                                                                                                let sinMarker = base64url(JSON.stringify(myObj));
                                                                                                let redirectURL = callback_url + "?sinMarker=" + sinMarker;
                                                                                                res.redirect(redirectURL);
                                                                                            })
                                                                                            .catch(function (error) {
                                                                                                logger.error("error while fetching user organization unit--->" + error);
                                                                                                var myObj = new Object();
                                                                                                myObj['message'] = "Something went wrong with social registration. Please try after sometime.";
                                                                                                // let redirectURL = callback_url+"?sinMarker=";
                                                                                                res.redirect(failureRedirectURL);
                                                                                            })

                                                                                    })
                                                                                    .catch(function (error) {
                                                                                        logger.error("error while checking google user--->" + error);
                                                                                        var myObj = new Object();
                                                                                        myObj['message'] = "Something went wrong with social registration. Please try after sometime.";
                                                                                        // let redirectURL = callback_url+"?sinMarker=";
                                                                                        res.redirect(failureRedirectURL);
                                                                                    })

                                                                            })
                                                                            .catch(function (error) {
                                                                                logger.error("Unable to create vhost>>>" + error)
                                                                                // res.status(500).send({"message":"already exist"});
                                                                                FUNCTION.rollbackUserRegistration(client, entry4.mail)
                                                                                    .then((response) => {
                                                                                        var myObj = new Object();
                                                                                        myObj['message'] = "Unable to register user right now. Please try after some time."; let redirectURL = callback_url + "?sinMarker=";
                                                                                        res.redirect(failureRedirectURL);
                                                                                    })
                                                                                    .catch((errorDelete) => {
                                                                                        logger.error("Error while rollback user entry from ldap if not able to create vhost>>" + errorDelete);
                                                                                        var myObj = new Object();
                                                                                        myObj['message'] = "Unable to register user right now. Please try after some time."; let redirectURL = callback_url + "?sinMarker=";
                                                                                        res.redirect(failureRedirectURL);
                                                                                    })

                                                                            })
                                                                    })
                                                                    .catch(function (error) {
                                                                        logger.error("error while vhost exist>>>" + error)
                                                                        /** Delete user UUID DN if uid insertion has been failed */
                                                                        FUNCTION.rollbackUserRegistration(client, entry4.mail)
                                                                            .then((response) => {
                                                                                var myObj = new Object();
                                                                                myObj['message'] = "Unable to register user right now. Please try after some time.";
                                                                                // let redirectURL = callback_url+"?sinMarker=";
                                                                                res.redirect(failureRedirectURL);
                                                                            })
                                                                            .catch((errorDelete) => {
                                                                                var myObj = new Object();
                                                                                logger.error("Error while rollback user entry from ldap if vhost exist. Error name: " + errorDelete.name);
                                                                                myObj['message'] = "Unable to register user right now. Please try after some time.";
                                                                                // let redirectURL = callback_url+"?sinMarker=";
                                                                                res.redirect(failureRedirectURL);
                                                                            })
                                                                    })
                                                            })
                                                            .catch(function (errorHandler) {
                                                                logger.error("Error while adding UID in ldap>>>", errorHandler);
                                                                /** Delete user UUID DN if uid insertion has been failed */
                                                                FUNCTION.deleteUser(client, uuidDN)
                                                                    .then((response) => {
                                                                        var myObj = new Object();
                                                                        myObj['message'] = "Unable to register user right now. Please try after some time.";
                                                                        // let redirectURL = callback_url+"?sinMarker=";
                                                                        res.redirect(failureRedirectURL);
                                                                    })
                                                                    .catch((errorDelete) => {
                                                                        logger.error("Error while deleting user and not able to add new UID in ldap>>" + errorDelete);
                                                                        var myObj = new Object();
                                                                        myObj['message'] = "Unable to register user right now. Please try after some time.";
                                                                        // let redirectURL = callback_url+"?sinMarker=";
                                                                        res.redirect(failureRedirectURL);
                                                                    })
                                                            })
                                                    })
                                            })
                                    })


                            }
                            /** if User is already exist than :
                             * Update the user information
                             * search user again
                             * return the response
                             */
                            else {

                                let userData = searchResults[0];

                                let userDN = userData.dn;
                                let memberOf = employeeType;
                                var change = new ldap.Change({
                                    operation: 'replace',
                                    modification: {
                                        employeeType: [memberOf]
                                    }
                                });

                                var change1 = new ldap.Change({
                                    operation: 'replace',
                                    modification: {
                                        l: [socailID]
                                    }
                                });

                                var promise1 = FUNCTION.modifyUser(client, userDN, change);
                                var promise2 = FUNCTION.modifyUser(client, userDN, change1);

                                Promise.all([promise1, promise2]).then((executeRes) => {
                                    var attributes = "*";
                                    var getAttributes = attributes.split(',');
                                    // Set the parameters for LDAP search
                                    var parameters = {
                                        filter: ldapFilter,
                                        scope: 'sub',
                                        attributes: getAttributes
                                    };

                                    FUNCTION.serchUser(client, ldapStartDN, parameters)
                                        .then(function (result) {
                                            var myObj = new Object();
                                            user = result[0];
                                            var attr = user.dn.split(",");

                                            /**
                                             * split DN on first occureence of comma
                                             * it will remove the uid from dn string
                                             */
                                            var ousearchDN = user.dn.split(/,(.+)/)[1];
                                            var ouparameters = {
                                                filter: '(ou=' + user.uid + ')',
                                                scope: 'sub',
                                                attributes: ['*']//['uid','sn','cn','mail', 'mobile', 'employeeType', 'title']
                                            };
                                            FUNCTION.serchUser(client, ousearchDN, ouparameters)
                                                .then(function (entry) {
                                                    let ouDetail = entry[0];
                                                    for (i = 0; i < attr.length; i++) {

                                                        // check for organization
                                                        if (attr[i].indexOf("o=") > -1) {
                                                            var temp = attr[i].split("=");
                                                            myObj.o = temp[1];
                                                        }

                                                        // check for organization unit
                                                        if (attr[i].indexOf("ou=") > -1) {

                                                            var temp = attr[i].split("=");
                                                            myObj.uuid = temp[1];
                                                            attr.splice(i, 1);
                                                        }
                                                        if (attr[i].indexOf("ou=") > -1) {

                                                            var temp = attr[i].split("=");
                                                            myObj.ou = temp[1];
                                                        }

                                                        // check for user Id
                                                        if (attr[i].indexOf("uid=") > -1) {
                                                            var temp = attr[i].split("=");
                                                            myObj.uid = temp[1];
                                                        }
                                                    }
                                                    let vhost = user.mail.split('@');
                                                    myObj.firstname = user.cn;
                                                    myObj.lastname = user.sn;
                                                    myObj.mobile = user.mobile;
                                                    myObj.mail = user.mail;
                                                    myObj.status = user.initials;
                                                    myObj.vhost = vhost[1];
                                                    myObj.company = user.o;
                                                    myObj.memberOf = user.employeeType;
                                                    myObj.bussiness_category = ouDetail['businessCategory'];

                                                    sess = req.session;
                                                    sess.username = user.uid;
                                                    sess.o = myObj.o;
                                                    sess.ou = myObj.ou;
                                                    sess.uid = myObj.uid;
                                                    sess.vhost = vhost[1];
                                                    sess.broker_password = ouDetail['userPassword'];
                                                    sess.bussiness_category = ouDetail['businessCategory'];
                                                    sess.session_id = req.sessionID;

                                                    myObj.sessionId = sess.session_id;
                                                    /** added line
                                                     * creating redis key for storing multiple session id of same user
                                                     * key pattern "sessions:pawan@mailinator.com"
                                                     */
                                                    rclient.sadd("sessions:" + myObj.uid, "sess:" + req.sessionID);
                                                    /** end */

                                                    let sinMarker = base64url(JSON.stringify(myObj));
                                                    let redirectURL = callback_url + "?sinMarker=" + sinMarker;
                                                    res.redirect(redirectURL);
                                                })
                                                .catch(function (error) {
                                                    logger.error("error while fetching user organization unit--->" + error);
                                                    var myObj = new Object();
                                                    myObj['message'] = "Something went wrong with social registration. Please try after sometime.";
                                                    // let redirectURL = callback_url+"?sinMarker=";
                                                    res.redirect(failureRedirectURL);
                                                })
                                        })
                                        .catch(function (error) {
                                            logger.error("error while fetching user OU information >>>>" + error);
                                            var myObj = new Object();
                                            myObj['message'] = "Something went wrong with social registration. Please try after sometime.";
                                            // let redirectURL = callback_url+"?sinMarker=";
                                            res.redirect(failureRedirectURL);
                                        })
                                })
                                    .catch((executeErr) => {
                                        logger.error("Error in modifying user information if email already exist in ldap>>>" + executeErr);
                                        var myObj = new Object();
                                        myObj['message'] = "Unable to login you right now. Please try after some time.";
                                        // let redirectURL = callback_url+"?sinMarker="
                                        res.redirect(failureRedirectURL);
                                    })

                            }
                        })
                        .catch((error) => {
                            logger.error("error in searching User>>>>" + error);
                            // let redirectURL = callback_url+"?sinMarker="
                            res.redirect(failureRedirectURL);
                        });

                })
                .catch((error) => {
                    logger.error("error in create ldap client>>>>" + error);
                    // let redirectURL = callback_url;
                    res.redirect(failureRedirectURL);
                });
        }

    });


/* Passport strategy for Outlook */
router.get('/Outlook', function (req, res, next) {
    // var callback_url;
    // if (req.callback_url) {
    //     callback_url = req.callback_url;
    // }
    let state = generate_state(req);
    passport.authenticate('windowslive', { scope: config.Outlook.scope, state: state })(req, res, next);
});

/** callback url */
router.get('/callback/Outlook', passport.authenticate('windowslive', { failureRedirect: failureRedirectURL }),
    function (req, res) {

        var restrictedDomains = config.restrictedDomains;
        let state = JSON.parse(base64url.decode(req.query.state));
        var key = state.vhost + ":profile";
        let uri_prefix = state["uri_prefix"];
        let host = req.get("HOST");
        let final_uri = "sociallogin"
        if (host === 'localhost:4200') {
            callback_url = "http://" + host + uri_prefix + final_uri;
        } else {
            callback_url = "https://" + host + uri_prefix + final_uri;
        }

        const employeeType = 'o365';
        var outlookUserData = req.user['_json'];
        // logger.info('outlookUserData>>>'+JSON.stringify(outlookUserData));
        if (outlookUserData.hasOwnProperty("error")) {
            logger.error(`Unable to fetch detail from outlook account : ${outlookUserData.error.message}`);
            res.redirect(failureRedirectURL);
        }
        else {
            let email = outlookUserData.EmailAddress.toLowerCase();

            /**split email with "@" */
            let fetchEmailpart = email.split('@');
            /** split the string again with "." and fetch the domain name of email */
            getDomainName = fetchEmailpart[1].split('.');
            if (restrictedDomains.includes(getDomainName[0])) {
                // res.status(401).send({"message":"Sorry, currently we accept only corporate account!"})
                res.redirect(failureRedirectURL + "?account=outlook");
            }
            else {
                let fullname = outlookUserData.DisplayName.split(' ');
                let firstname = fullname[0];
                let lastname = fullname[1];

                let getCompany = email.split('@');
                let companyName = getCompany[1];
                let socailID = outlookUserData.Id;
                var companyNameValue = "";

                let vhost = companyName;
                const companyDN = "o=" + companyName + "," + ldapStartDN;
                const technoDN = "ou=technology,o=" + companyName + "," + ldapStartDN;
                const uuidDN = "ou=" + email + "," + technoDN;
                const uidDN = "uid=" + email + "," + uuidDN;

                FUNCTION.createClient()
                    .then((client) => {
                        var attributes = "*";
                        ldapFilter = '(uid=' + email + ')';//filter.split(',');
                        ldapAttributes = attributes.split(',');
                        // Set the parameters for LDAP search
                        var parameters = {
                            filter: ldapFilter,
                            scope: 'sub',
                            attributes: ldapAttributes
                        };
                        FUNCTION.serchUser(client, ldapStartDN, parameters)
                            .then(function (searchResults) {
                                /** if searchResults is empty than create a new entry in following:
                                 * 1: Ldap
                                 * 2. Broker
                                 * 3. Redis
                                 */
                                if (searchResults.length == 0) {
                                    let userEmail = email;
                                    let provisioningPassword = FUNCTION.generate(8);
                                    /**
                                     * creating insertdata for each DN
                                     */
                                    const entry1 = {
                                        objectclass: ['organization'],
                                        o: companyName
                                    };
                                    const entry2 = {
                                        objectclass: ['organizationalUnit'],
                                        ou: 'technology'
                                    };

                                    /**
                                     * get busines category from businesscategory config
                                     */
                                    let userbusinessCategory = FUNCTION.getBusinessCategoryByDomain(vhost);

                                    const entry3 = {
                                        objectclass: ['organizationalUnit'],
                                        ou: userEmail,
                                        businessCategory: userbusinessCategory,
                                        userPassword: provisioningPassword
                                    };

                                    /**
                                     * Data type and values we are using
                                     *
                                     * employeeType: accountType (google,o365, ldap)
                                     * initials: accountStatus ('t', 'f')
                                     * title: primaryAccount ('primary', 'secondary')
                                     * employeeNumber: timestamp
                                     */
                                    let initials = 't';

                                    let timestampRegister = new Date().getTime();
                                    var company = companyName.split('.');
                                    // entry4['o']=company[0];
                                    if (company[0] != 'outlook') {
                                        companyNameValue = company[0];
                                    }
                                    else {
                                        companyNameValue = 'N/A';
                                    }
                                    let entry4 = {
                                        cn: firstname,
                                        sn: lastname,
                                        mail: email,
                                        objectclass: ['inetOrgPerson'],
                                        uid: email,
                                        employeeType: employeeType,
                                        title: "primary",
                                        initials: initials,
                                        employeeNumber: timestampRegister,
                                        l: socailID,
                                        o: companyNameValue
                                    };
                                    /** [CU-626] Create Hubspot Contact  */
                                    let hubspotContact = {
                                        method: "create",
                                        firstName: firstname,
                                        lastName: lastname,
                                        email: email,
                                        company: companyNameValue,
                                        phone: "",
                                        LeadStatus: "Connect Trial"
                                    }
                                    /** [CU-626] Create Hubspot Contact END */
                                    FUNCTION.createNewUser(client, companyDN, entry1)
                                        .catch(function (errorHandler) {

                                            if (errorHandler.name.indexOf('EntryAlreadyExistsError') > -1) {
                                                logger.error('No worries as the organization already exists>>' + errorHandler.name);
                                                return;
                                            }
                                            else {
                                                var myObj = new Object();
                                                myObj['message'] = "Some error occured while creating organization.";
                                                logger.error(myObj['message'] + ">>>" + JSON.stringify(errorHandler))
                                                res.redirect(failureRedirectURL);
                                            }

                                        })
                                        .then((val) => {
                                            /**
                                             * creating a organization unit under Organization
                                             */

                                            FUNCTION.createNewUser(client, technoDN, entry2)
                                                .catch(function (errorHandler) {
                                                    if (errorHandler.name.indexOf('EntryAlreadyExistsError') > -1) {
                                                        logger.error('No worries as the organization Unit already exists>>' + errorHandler.name);
                                                        return;
                                                    }
                                                    else {
                                                        var myObj = new Object();
                                                        myObj['message'] = "Some error occured while creating organization unit." + errorHandler.name;
                                                        logger.error(myObj['message'])
                                                        res.redirect(failureRedirectURL);
                                                    }
                                                })
                                                .then((result) => {
                                                    /**
                                                     * creating a dynamic UUID for new User
                                                     */
                                                    FUNCTION.createNewUser(client, uuidDN, entry3)
                                                        .catch(function (errorHandler) {
                                                            var myObj = new Object();
                                                            myObj['message'] = "Some error occured while creating UUID. Error name: " + errorHandler.name;
                                                            logger.error(myObj['message']);
                                                            res.redirect(failureRedirectURL);
                                                        })
                                                        .then((result) => {
                                                            /**
                                                             * Insert User information under the UUID
                                                             */

                                                            FUNCTION.createNewUser(client, uidDN, entry4)
                                                                .then(finalres => {

                                                                    /**
                                                                     * we have to send an email after user inserted in ldap
                                                                     */
                                                                    FUNCTION.checkvhost(userEmail)
                                                                        .then(function (result) {

                                                                            FUNCTION.createVhost(vhost, userEmail, provisioningPassword)
                                                                                .then(function (createRes) {


                                                                                    var newparameters = {
                                                                                        filter: '(uid=*)',
                                                                                        scope: 'sub',
                                                                                        attributes: ['*']
                                                                                    };
                                                                                    var myObj = new Object();
                                                                                    logger.info("searching user with uuidDN=" + uuidDN + ", newparameters=" + JSON.stringify(newparameters));
                                                                                    FUNCTION.serchUser(client, uuidDN, newparameters)
                                                                                        .then(function (result) {

                                                                                            user = result[0];
                                                                                            var attr = user.dn.split(",");

                                                                                            /**
                                                                                             * split DN on first occureence of comma
                                                                                             * it will remove the uid from dn string
                                                                                             */


                                                                                            var ousearchDN = user.dn.split(/,(.+)/)[1];
                                                                                            var ouparameters = {
                                                                                                filter: '(ou=' + user.uid + ')',
                                                                                                scope: 'sub',
                                                                                                attributes: ['*']//['uid','sn','cn','mail', 'mobile', 'employeeType', 'title']
                                                                                            };
                                                                                            FUNCTION.serchUser(client, ousearchDN, ouparameters)
                                                                                                .then(function (entry) {
                                                                                                    var ouDetail = entry[0];
                                                                                                    for (i = 0; i < attr.length; i++) {

                                                                                                        // check for organization
                                                                                                        if (attr[i].indexOf("o=") > -1) {
                                                                                                            var temp = attr[i].split("=");
                                                                                                            myObj.o = temp[1];
                                                                                                        }

                                                                                                        // check for organization unit
                                                                                                        if (attr[i].indexOf("ou=") > -1) {

                                                                                                            var temp = attr[i].split("=");
                                                                                                            myObj.uuid = temp[1];
                                                                                                            attr.splice(i, 1);
                                                                                                        }
                                                                                                        if (attr[i].indexOf("ou=") > -1) {

                                                                                                            var temp = attr[i].split("=");
                                                                                                            myObj.ou = temp[1];
                                                                                                        }

                                                                                                        // check for user Id
                                                                                                        if (attr[i].indexOf("uid=") > -1) {
                                                                                                            var temp = attr[i].split("=");
                                                                                                            myObj.uid = temp[1];
                                                                                                        }
                                                                                                    }
                                                                                                    let vhost = user.mail.split('@');
                                                                                                    myObj.firstname = user.cn;
                                                                                                    myObj.lastname = user.sn;
                                                                                                    myObj.mobile = user.mobile;
                                                                                                    myObj.mail = user.mail;
                                                                                                    myObj.status = user.initials;
                                                                                                    myObj.vhost = vhost[1];
                                                                                                    myObj.company = user.o;
                                                                                                    myObj.memberOf = user.employeeType;
                                                                                                    myObj.bussiness_category = ouDetail['businessCategory'];

                                                                                                    sess = req.session;
                                                                                                    sess.username = user.uid;
                                                                                                    sess.o = myObj.o;
                                                                                                    sess.ou = myObj.ou;
                                                                                                    sess.uid = myObj.uid;
                                                                                                    sess.vhost = vhost[1];
                                                                                                    sess.broker_password = ouDetail['userPassword'];
                                                                                                    sess.bussiness_category = ouDetail['businessCategory'];
                                                                                                    sess.session_id = req.sessionID;
                                                                                                    myObj.sessionId = sess.session_id;
                                                                                                    /** added line
                                                                                                     * creating redis key for storing multiple session id of same user
                                                                                                     * key pattern "sessions:pawan@mailinator.com"
                                                                                                     */
                                                                                                    rclient.sadd("sessions:" + myObj.uid, "sess:" + req.sessionID);
                                                                                                    /** end */

                                                                                                    /** [CU-626] Create Hubspot Contact  */
                                                                                                    FUNCTION.createHubspotContact(JSON.stringify(hubspotContact))
                                                                                                        .then((createContactRes) => {
                                                                                                            logger.info('createContactRes>>' + createContactRes);
                                                                                                        })
                                                                                                        .catch((createContactErr) => {
                                                                                                            logger.info('createContactErr>>' + createContactErr);
                                                                                                        });
                                                                                                    /** [CU-626] Create Hubspot Contact END */
                                                                                                    FUNCTION.socialregisterEmail(myObj)
                                                                                                        .then((emailRes) => {
                                                                                                            logger.info("email sent");
                                                                                                        })
                                                                                                        .catch((emailErr) => {
                                                                                                            logger.error("email not sent");
                                                                                                        });
                                                                                                    let sinMarker = base64url(JSON.stringify(myObj));
                                                                                                    let redirectURL = callback_url + "?sinMarker=" + sinMarker;
                                                                                                    res.redirect(redirectURL);
                                                                                                })
                                                                                                .catch(function (error) {
                                                                                                    logger.error("error while checking user organization unit information--->" + error);
                                                                                                    var myObj = new Object();
                                                                                                    myObj['message'] = "Something went wrong with social registration. Please try after sometime.";
                                                                                                    // let redirectURL = callback_url+"?sinMarker=";
                                                                                                    res.redirect(failureRedirectURL);
                                                                                                })
                                                                                        })
                                                                                        .catch(function (error) {
                                                                                            logger.error("error while checking outlook user--->" + error);
                                                                                            var myObj = new Object();
                                                                                            myObj['message'] = "Something went wrong with social registration. Please try after sometime.";
                                                                                            // let redirectURL = callback_url+"?sinMarker=";
                                                                                            res.redirect(failureRedirectURL);
                                                                                        })

                                                                                })
                                                                                .catch(function (error) {
                                                                                    logger.error("Unable to create vhost>>>" + JSON.stringify(error))

                                                                                    FUNCTION.rollbackUserRegistration(client, entry4.mail)
                                                                                        .then((response) => {
                                                                                            var myObj = new Object();
                                                                                            myObj['message'] = "Unable to register user right now. Please try after some time."; let redirectURL = callback_url + "?sinMarker=";
                                                                                            res.redirect(failureRedirectURL);
                                                                                        })
                                                                                        .catch((errorDelete) => {
                                                                                            var myObj = new Object();
                                                                                            logger.error("Error while rollback user entry if vhost create error ocurr>>" + errorDelete);
                                                                                            myObj['message'] = "Unable to register user right now. Please try after some time."; let redirectURL = callback_url + "?sinMarker=";
                                                                                            res.redirect(failureRedirectURL);
                                                                                        })

                                                                                })
                                                                        })
                                                                        .catch(function (error) {
                                                                            logger.error("error while vhost exist>>>" + error)
                                                                            /** Delete user UUID DN if uid insertion has been failed */
                                                                            FUNCTION.rollbackUserRegistration(client, entry4.mail)
                                                                                .then((response) => {
                                                                                    var myObj = new Object();
                                                                                    myObj['message'] = "Unable to register user right now. Please try after some time.";
                                                                                    // let redirectURL = callback_url+"?sinMarker=";
                                                                                    res.redirect(failureRedirectURL);
                                                                                })
                                                                                .catch((errorDelete) => {
                                                                                    var myObj = new Object();
                                                                                    logger.error("Error while rollback user entry if vhost exist. Error name: " + errorDelete.name);
                                                                                    myObj['message'] = "Unable to register user right now. Please try after some time.";
                                                                                    // let redirectURL = callback_url+"?sinMarker=";
                                                                                    res.redirect(failureRedirectURL);
                                                                                })
                                                                        })
                                                                })
                                                                .catch(function (errorHandler) {
                                                                    logger.error("Error while adding UID>>>" + errorHandler);
                                                                    /** Delete user UUID DN if uid insertion has been failed */
                                                                    FUNCTION.deleteUser(client, uuidDN)
                                                                        .then((response) => {
                                                                            var myObj = new Object();
                                                                            myObj['message'] = "Unable to register user right now. Please try after some time.";
                                                                            // let redirectURL = callback_url+"?sinMarker=";
                                                                            res.redirect(failureRedirectURL);
                                                                        })
                                                                        .catch((errorDelete) => {
                                                                            var myObj = new Object();
                                                                            logger.error("Error while rollback user entry if UID not added. Error name: " + errorDelete.name)
                                                                            myObj['message'] = "Unable to register user right now. Please try after some time.";
                                                                            // let redirectURL = callback_url+"?sinMarker=";
                                                                            res.redirect(failureRedirectURL);
                                                                        })
                                                                })
                                                        })
                                                })
                                        })


                                }
                                /** if User is already exist than :
                                 * Update the user information
                                 * search user again
                                 * return the response
                                 */
                                else {

                                    let userData = searchResults[0];
                                    let userDN = userData.dn;
                                    let memberOf = employeeType
                                    var change = new ldap.Change({
                                        operation: 'replace',
                                        modification: {
                                            employeeType: [memberOf]
                                        }
                                    });

                                    var change1 = new ldap.Change({
                                        operation: 'replace',
                                        modification: {
                                            l: [socailID]
                                        }
                                    });

                                    var promise1 = FUNCTION.modifyUser(client, userDN, change);
                                    var promise2 = FUNCTION.modifyUser(client, userDN, change1);

                                    Promise.all([promise1, promise2]).then((executeRes) => {
                                        var attributes = "*";
                                        var getAttributes = attributes.split(',');
                                        // Set the parameters for LDAP search
                                        var parameters = {
                                            filter: ldapFilter,
                                            scope: 'sub',
                                            attributes: getAttributes
                                        };
                                        FUNCTION.serchUser(client, ldapStartDN, parameters)
                                            .then(function (result) {
                                                user = result[0];
                                                var attr = user.dn.split(",");

                                                /**
                                                 * split DN on first occureence of comma
                                                 * it will remove the uid from dn string
                                                 */


                                                var ousearchDN = user.dn.split(/,(.+)/)[1];
                                                var ouparameters = {
                                                    filter: '(ou=' + user.uid + ')',
                                                    scope: 'sub',
                                                    attributes: ['*']//['uid','sn','cn','mail', 'mobile', 'employeeType', 'title']
                                                };
                                                FUNCTION.serchUser(client, ousearchDN, ouparameters)
                                                    .then(function (entry) {
                                                        var myObj = new Object();
                                                        var ouDetail = entry[0];
                                                        for (i = 0; i < attr.length; i++) {

                                                            // check for organization
                                                            if (attr[i].indexOf("o=") > -1) {
                                                                var temp = attr[i].split("=");
                                                                myObj.o = temp[1];
                                                            }

                                                            // check for organization unit
                                                            if (attr[i].indexOf("ou=") > -1) {

                                                                var temp = attr[i].split("=");
                                                                myObj.uuid = temp[1];
                                                                attr.splice(i, 1);
                                                            }
                                                            if (attr[i].indexOf("ou=") > -1) {

                                                                var temp = attr[i].split("=");
                                                                myObj.ou = temp[1];
                                                            }

                                                            // check for user Id
                                                            if (attr[i].indexOf("uid=") > -1) {
                                                                var temp = attr[i].split("=");
                                                                myObj.uid = temp[1];
                                                            }
                                                        }
                                                        let vhost = user.mail.split('@');
                                                        myObj.firstname = user.cn;
                                                        myObj.lastname = user.sn;
                                                        myObj.mobile = user.mobile;
                                                        myObj.mail = user.mail;
                                                        myObj.status = user.initials;
                                                        myObj.vhost = vhost[1];
                                                        myObj.company = user.o;
                                                        myObj.memberOf = user.employeeType;
                                                        myObj.bussiness_category = ouDetail['businessCategory'];

                                                        sess = req.session;
                                                        sess.username = user.uid;
                                                        sess.o = myObj.o;
                                                        sess.ou = myObj.ou;
                                                        sess.uid = myObj.uid;
                                                        sess.vhost = vhost[1];
                                                        sess.broker_password = ouDetail['userPassword'];
                                                        sess.bussiness_category = ouDetail['businessCategory'];
                                                        sess.session_id = req.sessionID;

                                                        myObj.sessionId = sess.session_id;
                                                        /** added line
                                                         * creating redis key for storing multiple session id of same user
                                                         * key pattern "sessions:pawan@mailinator.com"
                                                         */
                                                        rclient.sadd("sessions:" + myObj.uid, "sess:" + req.sessionID);
                                                        /** end */

                                                        let sinMarker = base64url(JSON.stringify(myObj));
                                                        let redirectURL = callback_url + "?sinMarker=" + sinMarker;
                                                        res.redirect(redirectURL);
                                                    })
                                                    .catch(function (error) {
                                                        logger.error("error while checking user organization unit info>>>" + JSON.stringify(error));
                                                        var myObj = new Object();
                                                        myObj['message'] = "Something went wrong with social registration. Please try after sometime.";
                                                        res.redirect(failureRedirectURL);
                                                    })
                                            })
                                            .catch(function (error) {
                                                logger.error("error while searching for user in ldap>>>>" + JSON.stringify(error));
                                                var myObj = new Object();
                                                myObj['message'] = "Something went wrong with social registration. Please try after sometime.";
                                                // let redirectURL = callback_url+"?sinMarker=";
                                                res.redirect(failureRedirectURL);
                                            })
                                    })
                                        .catch((executeErr) => {
                                            logger.error("error while modify outlook user info if email exist in ldap>>>" + executeErr);
                                            var myObj = new Object();
                                            myObj['message'] = "Unable to login you right now. Please try after some time.";
                                            // let redirectURL = callback_url+"?sinMarker="
                                            res.redirect(failureRedirectURL);
                                        })

                                }
                            })
                            .catch((error) => {
                                logger.error("error while checking User exist or not in ldap>>>>" + error);
                                // let redirectURL = callback_url+"?sinMarker="
                                res.redirect(failureRedirectURL);
                            });

                    })
                    .catch((error) => {
                        logger.error("error while ldap create client>>>>" + error);
                        // let redirectURL = callback_url;
                        res.redirect(failureRedirectURL);
                    });
            }
        }

    });

function generate_state(req) {
    let state = {
        uri_prefix: req.uri_prefix,
        vhost: req.vhost,
        username: req.username,
        callback_url: req.callback_url
    }
    state = base64url(JSON.stringify(state));
    return state;
}
module.exports = router;
