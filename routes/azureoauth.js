const express = require('express');
const router = express.Router();
const path = require('path');
let  passport = require('passport')
const config = require('../config/config.json');
const FUNCTION = require('../function.js');
const base64url = require('base64url');
const ldapStartDN = config.ldapDetails.base;
const ldap = require('ldapjs');
const failureRedirectURL=config.siteurl+"login";
const azureCallback = config.siteurl+config.frontProxy+"azureauth/callback/Azure";
var OIDCStrategy = require('passport-azure-ad').OIDCStrategy;
/** businesscategory config */
const businessCategory = require('../config/businesscategory.json');


passport.serializeUser(function(user, done) {
    done(null, user.oid);
  });
  
  passport.deserializeUser(function(oid, done) {
    findByOid(oid, function (err, user) {
      done(err, user);
    });
  });
  
  // array to hold logged in users
  var users = [];
  
  var findByOid = function(oid, fn) {
    for (var i = 0, len = users.length; i < len; i++) {
      var user = users[i];
     logger.info('we are using user: '+user);
      if (user.oid === oid) {
        return fn(null, user);
      }
    }
    return fn(null, null);
  };
  
  //-----------------------------------------------------------------------------
  // Use the OIDCStrategy within Passport.
  // 
  // Strategies in passport require a `verify` function, which accepts credentials
  // (in this case, the `oid` claim in id_token), and invoke a callback to find
  // the corresponding user object.
  // 
  // The following are the accepted prototypes for the `verify` function
  // (1) function(iss, sub, done)
  // (2) function(iss, sub, profile, done)
  // (3) function(iss, sub, profile, access_token, refresh_token, done)
  // (4) function(iss, sub, profile, access_token, refresh_token, params, done)
  // (5) function(iss, sub, profile, jwtClaims, access_token, refresh_token, params, done)
  // (6) prototype (1)-(5) with an additional `req` parameter as the first parameter
  //
  // To do prototype (6), passReqToCallback must be set to true in the config.
  //-----------------------------------------------------------------------------

  router.use( async function (req, res, next) {
    var ecosystem;
    var callback_url;

    if (!req.url.includes("callback")) {
        let host = req.get("HOST");
        var my_string = req.url.split("/");
        
        ecosystem = my_string[1].substring(0, my_string['1'].indexOf('?'));
        
        let uri_prefix = req.query.prefix;
         let final_uri = config.frontProxy + "/auth/callback/"+ ecosystem;


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

  passport.use(new OIDCStrategy({
      identityMetadata: config.Azure.identityMetadata,
      clientID: config.Azure.client_id,
      responseType: config.Azure.responseType,
      responseMode: config.Azure.responseMode,
      redirectUrl: azureCallback,
      allowHttpForRedirectUrl: true,
      prompt: 'consent',
      clientSecret: config.Azure.client_secret,
        validateIssuer: false,
        scope:config.Azure.scope,
        issuer: null,
        passReqToCallback:false
    },
    function(iss, sub, profile, accessToken, refreshToken, done) {
      if (!profile.oid) {
        return done(new Error("No oid found"), null);
      }
      // asynchronous verification, for effect...
      process.nextTick(function () {
        findByOid(profile.oid, function(err, user) {
          if (err) {
            return done(err);
          }
          if (!user) {
            // "Auto-registration"
            users.push(profile);
            return done(null, profile);
          }
          return done(null, user);
        });
      });
    }
  ));

  router.get('/Azure',
  function(req, res, next) {
    let state =  generate_state(req);
    logger.info("state in AZURE " +state)
    passport.authenticate('azuread-openidconnect', 
      { 
        response: res,                      // required
        prompt: 'select_account',
        resourceURL: config.resourceURL,    // optional. Provide a value if you want to specify the resource.
        customState: state,            // optional. Provide a value if you want to provide custom state value.
        failureRedirect: '/login' 
      }
    )(req, res, next);
  }
);
router.get('/callback/Azure', passport.authenticate('azuread-openidconnect'),function(req,res){
    
    const restrictedDomains = config.restrictedDomains;
    let customState = req.query.state;
    let state = JSON.parse(base64url.decode(customState));
    var key = state.vhost + ":profile";
    let uri_prefix = state["uri_prefix"];
    let host = req.get("HOST");
    let final_uri = "sociallogin";
    
    if (host === 'localhost:4200') {
        callback_url = "http://" + host + uri_prefix + final_uri;
    } else {
        callback_url = "https://" + host + uri_prefix + final_uri;
    }
    
    var ecosystem = req.params.ecosystem;
    var employeeType = 'AzureAD';
    var profileData = req.user._json;
    logger.info("yessss \n\n"+JSON.stringify(profileData) + '\n\n')
    let socailID = profileData.oid;

    let email =  "" ;

    if(profileData.hasOwnProperty('email')) {
        email = profileData.email.toLowerCase();
    } else {
        email = profileData.preferred_username.toLowerCase();
    }
    logger.info('email --->  '  + email);

    /**split email with "@" */
    let fetchEmailpart = email.split('@');
    /** split the string again with "." and fetch the domain name of email */
    getDomainName = fetchEmailpart[1].split('.');
    // logger.info("fetchEmailpart "+getDomainName)
    if(restrictedDomains.includes(getDomainName[0])){
        // res.status(401).send({"message":"Sorry, currently we accept only corporate account!"})
        res.redirect(failureRedirectURL+"?account=Azure");
    }
    else{
        // var googleUserData = req.user['_json'];
        let fullname = "";
        let firstname = "";
        let lastname = "";
        if(!profileData.hasOwnProperty('name')) {
             fullname = fetchEmailpart[0]+ " ";
             firstname = fetchEmailpart[0];
             lastname = " ";
        } else {
            fullname = profileData.name.split(' ');
             firstname = fullname[0];
             lastname = fullname[1];
        }

        let getCompany = email.split('@');
        let companyName = getCompany[1];
        var companyNameValue = "";
        
        let vhost = companyName;
        // logger.info("ALL Details"+fullname +"firstname"+firstname+ "Get COmpany"+companyName)
        const companyDN = "o="+companyName+","+ldapStartDN; 
        const technoDN = "ou=technology,o="+companyName+","+ldapStartDN; 
        const uuidDN = "ou="+email+","+technoDN; 
        const uidDN = "uid="+email+","+uuidDN; 
        
        FUNCTION.createClient()
        .then( (client)=>{
            var attributes = "*";
            ldapFilter = '(uid=' + email + ')';//filter.split(',');
            ldapAttributes = attributes.split(',');
            // Set the parameters for LDAP search
            var parameters = {
                filter: ldapFilter,
                scope: 'sub',
                attributes: ldapAttributes
            };
            logger.info("searching user with ldapStartDN="+ldapStartDN+", parameters="+JSON.stringify(parameters));
            FUNCTION.serchUser(client, ldapStartDN, parameters)
            .then(function(searchResults){
                /** if searchResults is empty than create a new entry in following:
                 * 1: Ldap
                 * 2. Broker
                 * 3. Redis
                 */
                logger.info('searchResults>>>>'+JSON.stringify(searchResults));
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
                    logger.info("entry2 data>>>"+JSON.stringify(entry2));

                    /**
                     * get busines category from businesscategory config
                     */
                    let userbusinessCategory = FUNCTION.getBusinessCategoryByDomain(vhost);
                
                    const entry3 = {
                            objectclass: ['organizationalUnit'],
                            ou: userEmail,
                            businessCategory:userbusinessCategory,
                            userPassword:provisioningPassword
                    };
                    logger.info("entry3 data>>>"+JSON.stringify(entry3));
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
                    if(company[0]!='gmail'){
                        companyNameValue = company[0];
                    }
                    else{
                        companyNameValue = 'N/A';
                    }

                    let entry4 = {
                        cn: firstname,
                        sn: lastname,
                        mail: email,
                        objectclass: ['inetOrgPerson'],
                        uid: email,
                        employeeType:employeeType,
                        title:"primary",
                        initials : initials,
                        employeeNumber: timestampRegister,
                        l:socailID,
                        o:companyNameValue
                    };
                    
                    let hubspotContact = {
                        method:"create",
                        firstName: firstname,
                        lastName: lastname,
                        email: email,
                        company:companyNameValue,
                        phone:"",
                        LeadStatus:"Connect Trial"
                    }
                    logger.info("entry4 data>>>"+JSON.stringify(entry4));

                    FUNCTION.createNewUser(client,companyDN,entry1)
                    .catch(function(errorHandler){
                        
                        if(errorHandler.name.indexOf('EntryAlreadyExistsError') >  -1) {
                                logger.info('No worries as the organization already exists>>'+errorHandler.name);
                                return;
                        }
                        else{
                            logger.error("Error while creating organization>>>"+errorHandler);
                            var myObj = new Object();
                            myObj['message']="Some error occured while creating organization.";
                            // let redirectURL = callback_url+"?sinMarker="
                            res.redirect(failureRedirectURL);
                        }
                        
                    })
                    .then((val)=>{
                        /**
                         * creating a organization unit under Organization
                         */
                        
                        FUNCTION.createNewUser(client,technoDN,entry2)
                        .catch(function(errorHandler){
                            if(errorHandler.name.indexOf('EntryAlreadyExistsError') >  -1) {
                                logger.info('No worries as the organization Unit already exists.'+errorHandler.name);
                                return;
                            }
                            else{
                                logger.error("Error while creating organization unit>>>"+errorHandler);
                                var myObj = new Object();
                                myObj['message']="Some error occured while creating organization unit."+errorHandler.name;
                                // let redirectURL = callback_url+"?sinMarker="
                                res.redirect(failureRedirectURL);
                            }
                        })
                        .then((result)=>{
                            /**
                             * creating a dynamic UUID for new User
                             */
                            FUNCTION.createNewUser(client,uuidDN,entry3)
                            .catch(function(errorHandler){
                                var myObj = new Object();
                                myObj['message']="Some error occured while creating UUID. Error name: "+errorHandler.name;
                                logger.error(myObj['message']);
                                res.redirect(failureRedirectURL);
                            })
                            .then((result)=>{
                                /**
                                 * Insert User information under the UUID
                                 */
                                FUNCTION.createNewUser(client,uidDN,entry4)
                                .then(finalres=>{
                                    /**
                                     * we have to send an email after user inserted in ldap
                                     */
                                    FUNCTION.checkvhost(userEmail)
                                    .then(function(result){
                                        
                                        FUNCTION.createVhost(vhost, userEmail,provisioningPassword)
                                        .then(function(createRes){
                                            /** add user information in Redis database */
                                            let custkey = vhost+":profile";
                                            /**checkUser In redis */
                                            // FUNCTION.checkUserInRedis(custkey, userEmail)
                                            //     .then(function (checkRedis) {
                                                    // let info = new Object();
                                                    // let userInfo = new Object();
                                                    // let user = [];
                                                    // userInfo.FullName = firstname+" "+lastname;
                                                    // userInfo.username= email;
                                                    // userInfo.password= provisioningPassword;
                                                    // userInfo.connections= [];
                                                    // user.push(userInfo);
                                                    // info['name']=company[0];
                                                    // info['user']=user;
                                                
                                                    // FUNCTION.insertInRedis(custkey, info)
                                                    // .then((redisRes)=>{
                                                
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
                                                            var ousearchDN =  user.dn.split(/,(.+)/)[1];
                                                            var ouparameters = {
                                                                filter: '(ou='+user.uid+')',
                                                                scope: 'sub',
                                                                attributes: ['*']//['uid','sn','cn','mail', 'mobile', 'employeeType', 'title']
                                                            };
                                                            logger.info("Searching user OU information with ousearchDN="+ousearchDN+", ouparameters="+JSON.stringify(ouparameters))
                                                            FUNCTION.serchUser(client, ousearchDN, ouparameters)
                                                            .then(function(entry){
                                                                let ouDetail = entry[0];
                                                                for(i=0; i < attr.length; i++) {
                
                                                                    // check for organization
                                                                    if(attr[i].indexOf("o=") > -1){
                                                                        var temp = attr[i].split("=");
                                                                        myObj.o = temp[1];
                                                                    }
                                                    
                                                                    // check for organization unit
                                                                    if(attr[i].indexOf("ou=") > -1){
                                                                        
                                                                        var temp = attr[i].split("=");
                                                                        myObj.uuid = temp[1];
                                                                        attr.splice(i, 1);
                                                                    }
                                                                    if(attr[i].indexOf("ou=") > -1){
                                                                        
                                                                        var temp = attr[i].split("=");
                                                                        myObj.ou = temp[1];
                                                                    }
                                                    
                                                                    // check for user Id
                                                                    if(attr[i].indexOf("uid=") > -1){
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
                                                                
                                                                myObj.sessionId=sess.session_id;
                                                                /** added line
                                                                 * creating redis key for storing multiple session id of same user
                                                                 * key pattern "sessions:pawan@mailinator.com" 
                                                                 */
                                                                rclient.sadd("sessions:" + myObj.uid, "sess:" + req.sessionID);
                                                                /** end */

                                                                /** [CU-626] Create Hubspot Contact  */
                                                                FUNCTION.createHubspotContact(JSON.stringify(hubspotContact))
                                                                .then((createContactRes)=>{
                                                                    logger.info('createContactRes>>'+createContactRes);
                                                                })
                                                                .catch((createContactErr)=>{
                                                                    logger.info('createContactErr>>'+createContactErr);
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
                                                                let redirectURL = callback_url+"?sinMarker="+sinMarker;
                                                                res.redirect(redirectURL);
                                                            })
                                                            .catch(function(error){
                                                                logger.error("error while fetching user organization unit--->"+ error);
                                                                var myObj = new Object();
                                                                myObj['message']="Something went wrong with social registration. Please try after sometime.";
                                                                // let redirectURL = callback_url+"?sinMarker=";
                                                                res.redirect(failureRedirectURL);
                                                            })
                                                            
                                                        })
                                                        .catch(function (error) {
                                                            logger.error("error while checking google user--->"+ error);
                                                            var myObj = new Object();
                                                            myObj['message']="Something went wrong with social registration. Please try after sometime.";
                                                            // let redirectURL = callback_url+"?sinMarker=";
                                                            res.redirect(failureRedirectURL);
                                                        })
                                                // })
                                                // .catch(existRedis=>{
                                                //     logger.error("Alredy exist in redis>>>" + existRedis)
                                                //     FUNCTION.rollbackUserRegistration(client, entry4.mail)
                                                //         .then((response) => {
                                                //             var myObj = new Object();
                                                //             myObj['message'] = "Unable to register user right now. Please try after some time.";
                                                //             if (!res.headersSent) {
                                                //                 res.redirect(failureRedirectURL);
                                                //             }
                                                //         })
                                                //         .catch((errorDelete) => {
                                                //             logger.error("Error while deleting user entry if exist in redis");
                                                //             var myObj = new Object();
                                                //             myObj['message'] = "Unable to register user right now. Please try after some time.";
                                                //             if (!res.headersSent) {
                                                //                 res.redirect(failureRedirectURL);
                                                //             }
                                                //         })

                                                // })
                                            
                                            
                                            // })
                                            // .catch((redisErr)=>{
                                            //     logger.error("Unable to insert user in redis database>>>>"+ redisErr);
                                            //     FUNCTION.rollbackUserRegistration(client, entry4.mail)
                                            //     .then((response)=>{
                                            //         var myObj = new Object();
                                            //         myObj['message']="Unable to register user right now. Please try after some time.";
                                            //         // let redirectURL = callback_url+"?sinMarker=";
                                            //         res.redirect(failureRedirectURL);
                                            //     })
                                            //     .catch((errorDelete)=>{
                                            //         logger.error("Error while rollback user entry from ldap and broker on redis error>>>"+errorDelete);
                                            //         var myObj = new Object();
                                            //         myObj['message']="Unable to register user right now. Please try after some time.";//"Some internal server error. Error name: "+errorDelete.name;
                                            //         // let redirectURL = callback_url+"?sinMarker=";
                                            //         res.redirect(failureRedirectURL);
                                            //     })
                                            // })
                                            
                                        })  
                                        .catch(function(error){
                                            logger.error("Unable to create vhost>>>"+ error)
                                            // res.status(500).send({"message":"already exist"});
                                            FUNCTION.rollbackUserRegistration(client, entry4.mail)
                                            .then((response)=>{
                                                var myObj = new Object();
                                                myObj['message']="Unable to register user right now. Please try after some time.";let redirectURL = callback_url+"?sinMarker=";
                                                res.redirect(failureRedirectURL);
                                            })
                                            .catch((errorDelete)=>{
                                                logger.error("Error while rollback user entry from ldap if not able to create vhost>>"+errorDelete);
                                                var myObj = new Object();
                                                myObj['message']="Unable to register user right now. Please try after some time.";let redirectURL = callback_url+"?sinMarker=";
                                                res.redirect(failureRedirectURL);
                                            })

                                        })
                                    })
                                    .catch(function(error){
                                        logger.error("error while vhost exist>>>"+ error)
                                        /** Delete user UUID DN if uid insertion has been failed */
                                        FUNCTION.rollbackUserRegistration(client, entry4.mail)
                                        .then((response)=>{
                                            var myObj = new Object();
                                            myObj['message']="Unable to register user right now. Please try after some time.";
                                            res.redirect(failureRedirectURL);
                                        })
                                        .catch((errorDelete)=>{
                                            var myObj = new Object();
                                            logger.error("Error while rollback user entry from ldap if vhost exist. Error name: "+errorDelete.name);
                                            myObj['message']="Unable to register user right now. Please try after some time.";
                                            // let redirectURL = callback_url+"?sinMarker=";
                                            res.redirect(failureRedirectURL);
                                        })
                                    })
                                })
                                .catch(function(errorHandler){
                                    logger.error("Error while adding UID in ldap>>>", errorHandler);
                                    /** Delete user UUID DN if uid insertion has been failed */
                                    FUNCTION.deleteUser(client, uuidDN)
                                    .then((response)=>{
                                        var myObj = new Object();
                                        myObj['message']="Unable to register user right now. Please try after some time.";
                                        // let redirectURL = callback_url+"?sinMarker=";
                                        res.redirect(failureRedirectURL);
                                    })
                                    .catch((errorDelete)=>{
                                        logger.error("Error while deleting user and not able to add new UID in ldap>>"+errorDelete);
                                        var myObj = new Object();
                                        myObj['message']="Unable to register user right now. Please try after some time.";
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
                else{

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
                    
                    Promise.all([promise1, promise2]).then((executeRes)=>{
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
                                var myObj= new Object();
                                user = result[0];
                                var attr = user.dn.split(",");

                                /**
                                 * split DN on first occureence of comma
                                 * it will remove the uid from dn string
                                 */
                                var ousearchDN =  user.dn.split(/,(.+)/)[1];
                                var ouparameters = {
                                    filter: '(ou='+user.uid+')',
                                    scope: 'sub',
                                    attributes: ['*']//['uid','sn','cn','mail', 'mobile', 'employeeType', 'title']
                                };
                                FUNCTION.serchUser(client, ousearchDN, ouparameters)
                                .then(function(entry){
                                    let ouDetail = entry[0];
                                    for(i=0; i < attr.length; i++) {

                                        // check for organization
                                        if(attr[i].indexOf("o=") > -1){
                                            var temp = attr[i].split("=");
                                            myObj.o = temp[1];
                                        }
                        
                                        // check for organization unit
                                        if(attr[i].indexOf("ou=") > -1){
                                            
                                            var temp = attr[i].split("=");
                                            myObj.uuid = temp[1];
                                            attr.splice(i, 1);
                                        }
                                        if(attr[i].indexOf("ou=") > -1){
                                            
                                            var temp = attr[i].split("=");
                                            myObj.ou = temp[1];
                                        }
                        
                                        // check for user Id
                                        if(attr[i].indexOf("uid=") > -1){
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
                                    
                                    myObj.sessionId=sess.session_id;
                                    /** added line
                                     * creating redis key for storing multiple session id of same user
                                     * key pattern "sessions:pawan@mailinator.com" 
                                     */
                                    rclient.sadd("sessions:" + myObj.uid, "sess:" + req.sessionID);
                                    /** end */

                                    let sinMarker = base64url(JSON.stringify(myObj));
                                    let redirectURL = callback_url+"?sinMarker="+sinMarker;
                                    res.redirect(redirectURL);
                                })
                                .catch(function(error){
                                    logger.error("error while fetching user organization unit--->"+ error);
                                    var myObj = new Object();
                                    myObj['message']="Something went wrong with social registration. Please try after sometime.";
                                    // let redirectURL = callback_url+"?sinMarker=";
                                    res.redirect(failureRedirectURL);
                                })
                            })
                            .catch(function (error) {
                                logger.error("error while fetching user OU information >>>>"+ error);
                                var myObj = new Object();
                                myObj['message']="Something went wrong with social registration. Please try after sometime.";
                                // let redirectURL = callback_url+"?sinMarker=";
                                res.redirect(failureRedirectURL);
                            })
                    })
                    .catch((executeErr)=>{
                        logger.error("Error in modifying user information if email already exist in ldap>>>"+ executeErr);
                        var myObj = new Object();
                        myObj['message']="Unable to login you right now. Please try after some time.";
                        // let redirectURL = callback_url+"?sinMarker="
                        res.redirect(failureRedirectURL);
                    })

                }
            })
            .catch( (error)=>{
                logger.error("error in searching User>>>>"+ error);
                // let redirectURL = callback_url+"?sinMarker="
                res.redirect(failureRedirectURL);
            });

        })
        .catch( (error)=>{
            logger.error("error in create ldap client>>>>"+ error);
            // let redirectURL = callback_url;
            res.redirect(failureRedirectURL);
        });
    
    }

});

// router.get('/callback/Azure',
//   function(req, res, next) {
//     passport.authenticate('azuread-openidconnect', 
//       { 
//         response: res,                      // required
//         failureRedirect: '/'  
//       }
//     )(req, res, next);
//   },
  
//   function(req, res) {
//     //log.info('We received a return from AzureAD.');
//     res.redirect('/');
//   });
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
