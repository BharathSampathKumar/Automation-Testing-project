# Automation Testing project
 Automating testing using Nodejs, Mochajs and Lambdatest

## Vision
* The primary purpose of this project is to test A/B tested content on webpages.
* This project can also be modified to test content by itself.
* In its completed state, the tests can be fully configurable without modifying code.

## Assumptions
A/B tests are already setup to qualify visitors for the experiences based on query parameter string.
For example, an Activity or A/B test (say Activty_1) could be setup to qualify a visitor for the segment/experience (say segment_1) with parameter segments=segment_1
Content change is guaranteed when applying one or more specific query parameter(s) to the page's URL.

## Current State
This project is incomplete! Tests would fail. The code is shared to offer inspiration. Perhaps you can help improve it :\)

### Implemented features:
* Testing content changes on one or more Activities
* Testing content changes on popular browsers
* Testing content changes on one or more user segments (or audiences)

### Pending or in-progress features:
* Screenshotting the tested contents
* Logging the results of the testing session in Excel file, including the content tested, and the results (i.e. PASS or FAIL).

## Project Structure
* `conf` - directory containing the following files
    * `common.utils.js` - contains the primary testing logic
    * `common.conf.js` - configuration required for Lambdatest when initializing browsing sessions
* `docs` - contains one or more sub directories; every sub directory stores info about test each with two files: `test-config.js` and `content-config.js` (contents of which are explained in individual sections below)
* `specs` - contains several configuration files. They will be used to execute the tests. nformation pertaining to configuring infividual tests.
* `.env` - Enviornment variables; Lambdatest username and key.

## `test-config.js`
Exports a JSON object containing the following items (keys)

* `qParam` - The URL query param `string` to qualify for the A/B test which will update/modify the content.
* `locationConfig` - Objects containing information specific to pages
    * `urls` - Array of `string` related to the location.
    * `components` - Array of component names rendered in the location
* `segments` - Objects containing segment name (key) + query params (Object \{param_name:param_value\})
* `priority` - (non-functional) numberical value representing the priority of the experience. When multiple changes on a particular content are applied, this value will determine the content that would prevail.
* `compConfigs` - Array of component configuration objects
    * `name` - Name of the component. 
    * `selector` - The selector to capture the component and further test its contents
    * `initState` - An object that can contain either a "script" entry or a "string" entry.
        * `script` - Lambdatest is capable of execute a script that would notify component load by executing a callback passed as `arguments[arguments.length-1]` in the session
        * `string` - A selector to understand if the component is initialized
    * `testCases` - Object to hold test case information entries
        * `compare` -  Object containing the content information. Key - content name; value - Object with following data structure:
            * `selector` - CSS selector to grab the content
            * `testAttrs` - Could be either of the following:
                1. Array of attributes to grab information
                    * `text` - captures innerHTML value
                    * `href` - captures attribute value
                    * `an-tr` - captures attribute value
                    * `an-ca` - captures attribute value
                    * `an-ac` - captures attribute value
                    * `an-la` - captures attribute value
                2. Object of attribute info entries. Key - attribute name; value - Regex
        * `evarTrks` - (non-functional) Array of Objects containing eVar click-tracking information. On click of CTAs, a network request is sent to Adobe Analytics containing information about configured dimensions (i.e. eVars). 
            * `selector` - CSS Selector
            * `{<eVar number>:<eVar value}`
* `fContents` - the JSON Object imported from `content-config.js`

Example data structure

```
{
    "qParam" : "adobeQA=test-1&automatedTest=true",
    "locationConfig" : {
        "location1" : {
            "urls" : ["/location1"],
            "components" : ["Component_name1"]
        }
    },
    "segments" : {
        "segment_name" : {
            "param_name" : "param_value"
        }
    },
    "priority" : 500,
    "compConfigs" : [
        {
            "name" : "Component_name1",
            "selector" : ".component_name1",
            "initState" : {
                "script" : 
                `const clbk = arguments[arguments.length-1];
                const focusSlideNum = 1;
                let crslComp = document.body.querySelector("#component-1");
                function isCrslInitd() {
                    return crslComp.classList.contains('component-1--initialized');
                }
                function onCrslInitd() {
                    clbk();
                }
                function onCrslMutations(mRecs, mObs) {
                    if(isCrslInitd()) mObs.disconnect(), onCrslInitd();
                }
                if(crslComp) {
                    if(isCrslInitd()) onCrslInitd();
                    else {
                        const mObsCnfg = {attributes: true};
                        let mObs = new MutationObserver(onCrslMutations);
                        mObs.observe(crslComp, mObsCnfg);
                    }
                }`
            },
            "testCases" : {
                "compare" : {
                    "cta" :  {
                        "selector" : '',
                        "testAttrs" : ['text', 'href', 'an-tr', 'an-ca', 'an-ac', 'an-la']
                    },
                    "slideIndicator" : {
                        "selector" : '',
                        "testAttrs" : ['text']
                    },
                    "textColor" : {
                        "selector" : '',
                        "testAttrs" : {
                            'class' : /text-color--(\S+)/,
                        }
                    }
                },
                "evarTrks" : [
                    {
                        "selector": "",
                        11 : "test-value"
                    }
                ]
            }
        }
    ],
    "fContents" : contentConfig
}
```

## `content-config.js`
This file stores the expected contents for each audience segment of the Activity
Exports a JSON object containing the following data structure
* (key) `Audience_name` String - name of the audience
* (value) Object of `'content_name' : 'content_value'` entries

## specs
This directory contains the Testing configuration to be able to combine multiple Activity specifications stored in individual sub folders within the `docs` folder.

Sample specs file configuration
### 1. Single Activity experience testing

```
const {testActivity} = require("../conf/common.utils"),
    { _920_test_config } = require("../" + "/docs/activty_1/activity_test_config.js");

var actvty = {
    "aname" : "PZN-920",
    "locationConfig" : _920_test_config["locationConfig"],
    "segments" : _920_test_config["segments"],
    "params" : _920_test_config["qParam"],
    "compConfigs" : _920_test_config["compConfigs"],
    "finalContents" : _920_test_config["fContents"]
};

testActivity(actvty);
```

### 2. Combined Activity experience testing
```
const {testActivities} = require("../conf/common.utils"),
    { _act1_test_config } = require("../" + "/docs/activity_1/activity_test_config.js"),
    { _act2_test_config } = require("../" + "/docs/activity_2/activity_test_config.js");

var actvty1 = {
    "aname" : "act_1",
    "locationConfig" : _act1_test_config["locationConfig"],
    "segments" : _act1_test_config["segments"],
    "params" : _act1_test_config["qParam"],
    "compConfigs" : _act1_test_config["compConfigs"],
    "finalContents" : _act1_test_config["fContents"]
};

var actvty2 = {
    "aname" : "act_2",
    "locationConfig" : _act2_test_config["locationConfig"],
    "segments" : _act2_test_config["segments"],
    "params" : _act2_test_config["qParam"],
    "compConfigs" : _act2_test_config["compConfigs"],
    "finalContents" : _act2_test_config["fContents"]
};

testActivities(actvty1, actvty2);
```

## How to use
1. `npm install`
2. `npm run test`