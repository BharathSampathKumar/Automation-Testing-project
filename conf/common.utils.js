require('dotenv').config();

const util = require('node:util');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const xlsx = require('xlsx');

const assert = require("assert");
const { By, Builder, Browser, Options } = require('selenium-webdriver');
const Chrome = require('selenium-webdriver/chrome');
const Firefox = require('selenium-webdriver/firefox');
const Safari = require('selenium-webdriver/safari');

const { capabilities, browserNames, platforms } = require("./common.conf");


var tstLogWriter;

let driver = null;

const resultsLogsDir = __dirname+'/../Test Results';

let resultsLogsFile = "";
let cDateTime = new Date();
var dateNow = cDateTime.toLocaleDateString().split("/").reverse().join("-");
var timeStr = cDateTime.toTimeString().split(" ")[0].split(":").join("-");

var username = process.env.LT_USERNAME,
    accessKey = process.env.LT_ACCESS_KEY;

capabilities["LT:Options"]["username"] = username;
capabilities["LT:Options"]["accessKey"] = accessKey;

function onUncaught(err) {
    console.error(err);
    process.exit(1);
}
  
process.on('unhandledRejection', onUncaught);

var buildDriver = async function (caps, browserName) {
    let drvr = new Builder()
    .usingServer(
    "http://" +
    username +
    ":" +
    accessKey +
    "@hub.lambdatest.com/wd/hub"
    );
    switch(browserName) {
        case "Chrome":
            drvr.setChromeOptions(new Chrome.Options().setPageLoadStrategy('normal'));
            break;
        case "Firefox":
            drvr.setFirefoxOptions(new Firefox.Options().setPageLoadStrategy('normal'))
            break;
        case "Safari":
            drvr.setSafariOptions(new Safari.Options().setPageLoadStrategy('normal'));
    }
    return await drvr.withCapabilities(caps).build();
}

var readRelevantContents = async function (tstSuiteConfig, driver) {
    //function escapeRegExp(string) {
        //return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    //}
    async function readElementAttributes(elem, anames) {
        async function getAttributeByName(elem, aname, regexp) {
            var aVal = "";
            switch (aname) {
                case "text":
                    aVal = await elem.getAttribute('innerHTML');
                    break;
                case "href":
                case "class":
                case "an-tr":
                case "an-ca":
                case "an-ac":
                case "an-la":
                case "src":
                    aVal = await elem.getAttribute(aname);
                    break;
            }
            if(aVal && regexp) {
                //tstResLogger.log("Matching pattern ", regexp);
                var aValMatch = aVal.match(regexp);
                //tstResLogger.log("Matches: ", aValMatch);
                if(aValMatch && aValMatch.length > 0)
                    aVal = [].slice.call(aValMatch)[1];
                //else
                    //tstResLogger.error("Unable to find matches");
            }
            return aVal;
        }
        
        //tstResLogger.log("Reading contents...");

        // Multiple attrs to read
        if (Array.isArray(anames)) {
            if(anames.length > 1) {
                let attrValObj = {};
                for (const aname of anames)
                    attrValObj[aname] = await getAttributeByName(elem, aname);
                return attrValObj;
            }
            else return await getAttributeByName(elem, anames[0]);
        }
        else if("object" == typeof anames) {
            var attrArr = Object.entries(anames);
            if(attrArr.length > 1) {
                let attrVal = {};
                for (const [aname, attrMatch] of attrArr)
                    attrVal[aname] = await getAttributeByName(elem, aname, attrMatch);
                return attrVal;
            }
            else
                return await getAttributeByName(elem, attrArr[0], attrArr[1]);
        }
        else if("string"  == typeof anames)
            return await getAttributeByName(anames);
    }

    let contents = {};

    for (const testSuite of tstSuiteConfig) {
        const cName = testSuite["name"];
        const cSelector = testSuite["selector"];
        const testCases = testSuite["testCases"];
        let comp = await driver.findElement(By.css(cSelector));
        if(comp) {
            console.log("Located component "+ cName);
            contents[cName] = {};
            let compContents = {};
            const compare = testCases["compare"];
            
            const elemTConfs = Object.entries(compare);
            if(elemTConfs && elemTConfs.length > 0) {
                for (const [elemName, elemTConfig] of elemTConfs) {
                    const elemSelector = elemTConfig["selector"];
                    const elemTAttrs = elemTConfig["testAttrs"];
                    try {
                        let elem = await comp.findElement(By.css(elemSelector));
                        if(elem) {
                            console.log("Located element "+elemName);
                            const attrVals = await readElementAttributes(elem, elemTAttrs);
                            if(attrVals) compContents[elemName] = attrVals;
                        }
                        else
                            console.error("Unable to locate element ", elemName);
                    }
                    catch (err) {
                        console.error("Error encountered while locating element "+elemName+"\n", err);
                    }
                }
            }
            contents[cName] = compContents;
        }
    }
    return contents;
}

var getCombinations = function (paramsArr) {
    var divisors = [];
    for (var i = paramsArr.length - 1; i >= 0; i--) {
        divisors[i] = divisors[i + 1] ? divisors[i + 1] * paramsArr[i + 1].length : 1;
    }

    function getPermutation(n, paramsArr) {
        var result = [], 
            curArray;    
        for (var i = 0; i < paramsArr.length; i++) {
            curArray = paramsArr[i];
            result.push(curArray[Math.floor(n / divisors[i]) % curArray.length]);
        }    
        return result;
    }

    var numPerms = paramsArr[0].length;
    for(var i = 1; i < paramsArr.length; i++) {
        numPerms *= paramsArr[i].length;
    }

    var combinations = [];
    for(var i = 0; i < numPerms; i++) {
        combinations.push(getPermutation(i, paramsArr));
    }
    return combinations;        
}

async function initTestSuite(_platform, _browser, allActvtyConfigs) {
    
    function testSuiteExists (tstSteCnfg) {
        let _url = this;
        return tstSteCnfg["url"] == _url;
    }

    function isTstConfigComps(compConfig) {
        const compNames = this;
        return compNames.has(compConfig["name"]);
    }

    function mergeCompConfigs(cConf1, cConf2) {
        //console.log("merging configs:", cConf1, cConf2);
        let mergdCmpCnf = cConf1;
        Object.entries(cConf2["testCases"]).forEach(([tcType, tcObj]) => {
            switch(tcType) {
                case "compare":
                    const mComparCaseObj = mergdCmpCnf["testCases"]["compare"];
                    const tgtTstCaseObjs = Object.entries(tcObj).filter(([tstCaseName, tstCaseObj]) => !mComparCaseObj[tstCaseName]);
                    tgtTstCaseObjs.forEach(([tgtTstCaseName, tgtTstCaseObj]) => {
                        mergdCmpCnf["testCases"]["compare"][tgtTstCaseName] = tgtTstCaseObj;
                    });
                break;
            }
        });
        return mergdCmpCnf;
    }
    
    function writeContentsToCsv (contents) {
        Object.entries(contents).forEach(([cName, compContents]) => {
            tstLogWriter.write("Component: "+cName+",");
            //tstResLogger.log(Object.keys(compContents).join(",")+",");
            Object.entries(compContents).forEach(([cntName, cntVal]) => {
                if(typeof cntVal == "object") {
                    tstLogWriter.write(cntName+",");
                    Object.entries(cntVal).forEach(([cntValName, cntValVal]) => tstLogWriter.log(cntValName+","+JSON.stringify(cntValVal)+","));
                }
                else
                    tstLogWriter.write(cntName+","+JSON.stringify(cntVal)+",");
            });
        });
    }

    const tstAname = allActvtyConfigs.map(cnfg => cnfg["aname"]).reduce((acc, curr) => acc+" and "+curr);
    const tstResPath = path.join(resultsLogsDir, tstAname, dateNow, timeStr);
    const screenshotsPath = path.join(tstResPath, "screenshots");

    await fsp.mkdir(tstResPath, {recursive: true});
    await fsp.mkdir(screenshotsPath, {recursive: true});

    resultsLogsFile = path.join(tstResPath, 'results.csv');
    
    tstLogWriter = fs.createWriteStream(resultsLogsFile);
    //tstResLogger = new console.Console(tstLogWriter);
    let logStr = "Title," + tstAname + "@" + dateNow + ",\n";
    logStr += "Platform," + _platform + ",\n";
    logStr += "Browser," + _browser + ",";
    tstLogWriter.write(logStr);
    
    var _caps = capabilities;
    _caps["LT:Options"]["platformName"] = _platform;
    _caps["browserName"] = _browser;

    var testSuiteConfigs = [];
    var testSuiteConfig;
    
    allActvtyConfigs.forEach(actvtyConfig => {
        let locConfigs = actvtyConfig["locationConfig"];
        let segConfigs = actvtyConfig["segments"];
        Object.entries(locConfigs).forEach(([locName, locUrlCompConfig]) => {
            const urls = locUrlCompConfig["urls"];
            urls.forEach(url => {

                var newSegmentsObj = {};
                Object.entries(segConfigs).forEach(([segmentName, segmentParamsObj]) => {
                    let paramStr = "";
                    Object.entries(segmentParamsObj)
                    .forEach(([pName, pVal], indx) => {
                        if(indx > 0)
                            paramStr += "&";
                        paramStr += pName + "=" + pVal;
                    })
                    newSegmentsObj[segmentName] = paramStr;
                });

                const testSuiteConfigIndx = testSuiteConfigs.findIndex(testSuiteExists, url);
                testSuiteConfig = testSuiteConfigs[testSuiteConfigIndx];
                if(!testSuiteConfig) {
                    testSuiteConfig = {
                        "url" : url,
                        "location" : locName,
                        "qParam" : [actvtyConfig["params"]],
                        "activities" : [actvtyConfig["aname"]],
                        "components" : new Set(locUrlCompConfig["components"]),
                        "segments" : [Object.entries(newSegmentsObj)]
                    };
                    testSuiteConfigs.push(testSuiteConfig);
                }
                else {
                    let comps = testSuiteConfigs[testSuiteConfigIndx]["components"];
                    locUrlCompConfig["components"].forEach(cName => comps.add(cName));
                    testSuiteConfigs[testSuiteConfigIndx]["components"] = comps;

                    let segments = testSuiteConfigs[testSuiteConfigIndx]["segments"];
                    segments.push(Object.entries(newSegmentsObj));
                    testSuiteConfigs[testSuiteConfigIndx]["segments"] = segments;

                    let actvts = testSuiteConfigs[testSuiteConfigIndx]["activities"];
                    actvts.push(actvtyConfig["aname"]);
                    testSuiteConfigs[testSuiteConfigIndx]["activities"] = actvts;

                    let qParams = testSuiteConfigs[testSuiteConfigIndx]["qParam"];
                    qParams.push(actvtyConfig["params"]);
                    testSuiteConfigs[testSuiteConfigIndx]["qParam"] = qParams;
                }
            });
        });
    });

    testSuiteConfigs.forEach((_testSuiteConfig) => {
        let segmentNames = [], segmentVals = [];
        let segmentConfigs = _testSuiteConfig["segments"];
        segmentConfigs.forEach(segmentConfig => {
            let sNames = [], sVals = [];
            segmentConfig.forEach(segmentInfoArr => {
                sNames.push(segmentInfoArr[0]);
                sVals.push(segmentInfoArr[1]);
            });
            segmentNames.push(sNames);
            segmentVals.push(sVals);
        });
        let pNameCombs = getCombinations(segmentNames);
        let pValCombs = getCombinations(segmentVals);
        
        let combndSegmentsObj = {};
        pNameCombs.forEach((pNameArr, indx) => {
            combndSegmentsObj[pNameArr.join(' and ')] = pValCombs[indx].join("&");
        })

        _testSuiteConfig["segments"] = combndSegmentsObj;
        
        let qParams = _testSuiteConfig["qParam"];
        let qPStr = "";
        qParams
        .forEach((qParamStr, indx) => {
            if(indx > 0)
                qPStr += "&";
            qPStr = qParamStr;
        });
        _testSuiteConfig["qParam"] = qPStr;
    });
    
    console.log(util.inspect(testSuiteConfigs, {showHidden: false, depth: null, colors: true}));

    for (var i=0;i < testSuiteConfigs.length;i++) {
        const _testSuiteConfig = testSuiteConfigs[i];
        const tstLoc = _testSuiteConfig["location"];
        //const tstAname = _testSuiteConfig["activities"].join(' and ');
        const comps = _testSuiteConfig["components"];
        const tstUrl = _testSuiteConfig["url"];
        const tstSegs = _testSuiteConfig["segments"];

        var default_contents, updated_contents;

        var compConfigs = [];

        allActvtyConfigs.forEach(function toCompConfigs(aConfig) {
            let _compConfigs = aConfig["compConfigs"].filter(isTstConfigComps, comps);
            _compConfigs.forEach(_compConf => {
                let indx = compConfigs.findIndex(compConfig => compConfig["name"] == _compConf["name"]);
                if(indx == -1)
                    compConfigs.push(_compConf);
                else
                    compConfigs[indx] = mergeCompConfigs(compConfigs[indx], _compConf);
            });
        });
        
        console.log(util.inspect(compConfigs, {showHidden: false, depth: null, colors: true}));

        console.log("Testing in location: "+tstLoc, "\tURL: "+tstUrl);
        tstLogWriter.write(",\nLocation,"+tstLoc+","+tstUrl+",");

        it("Control experience", async function () {
            this.timeout(0);
            console.log("Loading control experience and reading contents");

            before(async function () {
                _caps["LT:Options"]["build"] = tstAname;
                _caps["LT:Options"]["name"] = "Control experience";

                driver = await buildDriver(_caps, _browser);

                const default_url = tstUrl + "?mboxDisable=1";
                const logStr = ",\nControl Experience"+","+default_url;
                tstLogWriter.write(logStr);

                await driver.get(default_url);
                const sessionInfo = await driver.getSession();
                console.log(sessionInfo.id_);
            });
            
            compConfigs.forEach(async function (compConfig) {
                let compInitWaitConfig = {
                    "name": compConfig["name"],
                    "script": compConfig["initState"]["script"],
                    "selector": compConfig["initState"]["selector"]
                }
                if(compInitWaitConfig["script"])
                    await driver.executeAsyncScript(
                        compInitWaitConfig["script"]
                    );
                else if (compInitWaitConfig["selector"])
                    await driver.executeAsyncScript(
                        `const clbk = arguments[arguments.length-1];
                        const selector = "`+compInitWaitConfig["selector"]+`";
                        (function waitForCompInit() {
                            if(!document.body.querySelector(selector))
                                return window.setTimeout(waitForCompInit, 250);
                            clbk();
                        })();`
                    )
                driver.takeScreenshot().then(function onScreenshotComplete(data) {
                    var base64Data = data.replace(/^data:image\/png;base64,/,"");
                    fs.writeFile(path.join(screenshotsPath, "Control_Experience.png"), base64Data, 'base64', function(err) {
                        if(err) console.log(err);
                    });
                });
                
                default_contents += await readRelevantContents(compConfig, driver);
                //console.log(util.inspect(default_contents, {showHidden: false, depth: null, colors: true}));
                
            });
            
            //console.log(util.inspect(default_contents, {showHidden: false, depth: null, colors: true}));
            writeContentsToCsv(default_contents);

            after(async function () {
                // TODO Compare with finalContents
                assert.ok(default_contents);

                driver.executeScript('lambda-status=passed');

                await driver.quit();
                
            });
        });
        
        
        describe("Loading test experiences", function () {
            this.timeout(0);
            var cIndx = 0;
            var tstSegNames = Object.keys(tstSegs);
            
            beforeEach(async function () {
                const cName = tstSegNames[cIndx++];
                _caps["LT:Options"]["build"] = tstAname + " " + dateNow;
                _caps["LT:Options"]["name"] = cName;
                driver = await buildDriver(_caps, _browser);
                const sessionInfo = await driver.getSession();
                console.log(sessionInfo.id_);
            })
            
            //tstResLogger.log("Loading test experiences");
            Object.entries(tstSegs).forEach(async function ([tstSegName, tstSegCombndParam])  {
                const exp_url = tstUrl + "?" + _testSuiteConfig["qParam"] + "&" + tstSegCombndParam;
                
                it(tstSegName + " experience", async function () {

                    tstLogWriter.write("\n" + tstSegName + " experience"+ "," + exp_url);

                    try {
                        await driver.get(exp_url);
                        
                        initConfig.forEach(async initCnfg => {
                            if(initCnfg["script"]) {
                                await driver.executeAsyncScript(
                                    function () {
                                        const script = arguments[0];
                                        const _cName = arguments[1];
                                        const clbk = arguments[arguments.length-1];
                                        document.documentElement.addEventListener('component-'+_cName+'-inited', function onCompInitEvt() {
                                            console.log("Component "+_cName+" initialize event detected!");
                                            clbk();
                                        });
                                        eval(script.replace(/{_cName}/g, _cName));
                                    }
                                    , initCnfg["script"], initCnfg["name"]
                                );
                            }
                            // TODO logic for selector
                        });

                        updated_contents = await readRelevantContents(compConfigs, driver);
                        assert.ok(updated_contents);
                        writeContentsToCsv(updated_contents);
                        //console.log(updated_contents);
                        console.log(util.inspect(updated_contents, {showHidden: false, depth: null, colors: true}));
                        driver.executeScript('lambda-status=passed');
                    }
                    catch (err) {
                        console.error(err);
                        driver.executeScript('lambda-status=failed');
                    }
                });
            });

            afterEach(async function() {
                await driver.quit();
            });
        });
        
    }
}

exports.testActivity = async function (actvtyConfig) {
    //let tstBrowsers = browserNames;
    //let tstPlatforms = platforms;
    //workbook = xlsx.utils.book_new();
    try {
        await initTestSuite("windows 10", "Chrome", [actvtyConfig]);
    }
    catch(err) {
        console.error(err);
    }
    //initTestSuite("windows-10", "Firefox");
    //initTestSuite("windows-10", "MS Edge");
    //initTestSuite("macOS Ventura", "Safari");
    //initTestSuite("macOS Ventura", "Chrome");
    // TODO mobile devices
    /*
    platforms.forEach(function forEveryPlatform(_platform) {
        browsers.forEach(function forEveryBrowser(_browser) {
            //runTests(_platform, _browser);
        });
    });
    */
}

exports.testActivities = async function (...actvtyConfigs) {
    try {
        await initTestSuite("windows 10", "Chrome", actvtyConfigs);
    }
    catch(err) {
        console.error(err);
    }
}

