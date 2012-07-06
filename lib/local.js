"use strict";

module.exports = local;
local.usage = ["",
        "fhc local app=<appId> domain=<domain> port=<port> package=<package>",
        "where domain is the domain where your the app is hosted (For example: 'http://apps.feedhenry.com' - domain=apps)",
        "'port' is not required, the default port is 8888",
        "'packages' is not required, packages are used to tell the server where to look for files. Multiple packages can be specified, seperated by a ','",
        ""].join("\n");


var http = require("http"),
  https = require("https"),
  url = require("url"),
  path = require("path"),
  fs = require("fs"),
  util = require("util"),
  events = require("events"),
  common = require("./common"),
  log = require("./utils/log"),
  fhc = require("./fhc"),
  mimeTypes = {
    js: "text/javascript",
    css: "text/css",
    html: "text/html",
    xml: "text/xml",
    txt: "text/plain"
  },
  defaultArgs = {
    baseDomain: {
      required: true,
      val: "feedhenry.com"
    },
    port: {
      required: true,
      val: 8888
    },
    domain: {
      required: true,
      val: "apps"
    },
    app: {
      required: true,
      val: "localguidplaceholder"
    },
    packages: {
      required: false
    },
    index: {
      required: true,
      val: "index.html"
    },
    proxy: {
      required: true,
      val: "false"
    },
    watch: {
      required: true,
      val: "true"
    }
  },
  initParams = {
    appMode:"debug",
    checkDeliveryScheme:true,
    debugCloudType:"fh",
    debugCloudUrl:"https://",
    deliveryScheme:"https://",
    destination:{
      inline:false,
      name:"studio"
    },
    domain:"",    //required
    host:"",
    nameserver:"https://ainm.feedhenry.com",
    releaseCloudType:"fh",
    releaseCloudUrl:"https://",
    urltag:"",
    useSecureConnection:true,
    user:{
      id:"YqxcBngHv4nt3j1VstTjQj0X",
      role:"sub"
    },
    widget:{
      guid:"",    // required
      inline:false,
      instance:"",// required
      version:333
    }
  };


fs.exists = fs.exists || path.exists;
fs.existsSync = fs.existsSync || path.existsSync;

http.ServerResponse.prototype.writeError = function(code, desc) {
  this.writeHead(code, {
    "Content-Type": mimeTypes.txt
  });
  this.end(desc + "\n");
};


function validateArgs(args) {
  for(var i in defaultArgs) {
    var defaultArg = defaultArgs[i];
    if(args[i] === undefined) {

      if(defaultArg.required) {
        if(!defaultArg.val) {
          throw new Error("Missing '" + i + "' parameter");
        }
        else if(defaultArg.val) {
          args[i] = defaultArg.val;
        }
      }
    }
  }
}


function local(args, cb) {
  var argObj;
  try {
     argObj = common.parseArgs(args);

    if(argObj.app !== undefined ){/*look for alias*/
      argObj.app = fhc.appId(argObj.app);
    }
    if(!argObj.domain) {
      argObj.domain = fhc.target;
    }

    validateArgs(argObj);

  } catch (x) {
    return cb("Error processing args: " + x + "\nUsage: " + local.usage);
  }

  if(argObj.packages) {
    argObj.packages = argObj.packages.split(",");
  }
  argObj.proxy = argObj.proxy === "true";
  argObj.watch = argObj.watch === "true";
  

  var server = new LocalServer(argObj);
  server.start(argObj.port);
}



function LocalServer(options) {
  this.subDomain = options.domain || "apps";
  this.baseDomain = options.baseDomain || "feedhenry.com";

  this.handlers = [];

  if(options.proxy) {
    this.handlers.push(new RemoteActHandler(options));
  }
  else {
    this.handlers.push(new LocalActHandler(options));
  }

  this.handlers.push(new StaticHandler(options));

  this.server = http.createServer(this.handleRequest.bind(this));
  this.server.on("error", function(e) {
    log.verbose(e);
  });

  this.defaultHandler = new RequestHandler();
}
util.inherits(LocalServer, events.EventEmitter);


LocalServer.prototype.start = function(port) {
  this.server.listen(port);
  console.log("server listening on port:", port);
  console.log("go to http://127.0.0.1:" + port + "/ in your browser");
};

LocalServer.prototype.handleRequest = function(request, response) {
  var handlers = this.handlers,
    handled = false;

  for(var i = 0, il = handlers.length; i < il && !handled; i++) {
    var handler = handlers[i];

    handled = handler.canHandle(request);
    if(handled) {
      handler.handleRequest(request, response);
    }
  }

  if(!handled) {
    this.defaultHandler.handleRequest(request, response);
  }
};



function RequestHandler(options) {
  options = options || {};
  this.subDomain = options.domain || "apps";
  this.baseDomain = options.baseDomain || "feedhenry.com";
  this.domain = this.subDomain + "." + options.baseDomain;
  this.guid = options.app || options.guid || "";
}

RequestHandler.prototype.canHandle = function() {
  return true;
};

RequestHandler.prototype.handleRequest = function(request, response) {
  response.writeError(500, "No handler supplied");
};

RequestHandler.prototype.listenTo = function(directory) {
  var self = this;
  var timeout;
  fs.watch(directory, function(e, filename) {
    clearTimeout(timeout);
    timeout = setTimeout(function() {
      self.handleFileSystemChange(e, filename);
    }, 10);
  });
};
RequestHandler.prototype.handleFileSystemChange = function() {};


function ActHandler(options) {
  options = options || {};
  RequestHandler.call(this, options);
}
util.inherits(ActHandler, RequestHandler);

ActHandler.prototype.canHandle = function(request) {
  return request.method === "POST";
};


// remote act handler
// proxies act requests to the feedhenry cloud and
// writes the response back to the client
function RemoteActHandler(options) {
  options = options || {};
  ActHandler.call(this, options);
}
util.inherits(RemoteActHandler, ActHandler);

RemoteActHandler.prototype.handleRequest = function(request, response) {
  var requestParams = url.parse(request.url, true),
    uri = requestParams.pathname,
    uriComponents = uri.split("/"),
    act = uriComponents[uriComponents.length - 2],
    params = "";

  log.silly("Proxying act request");
  log.silly(uri, "url");
  log.silly(act, "act");

  //delete request.headers.host;

  var opts = {
    path: uri,
    method: request.method,
    host: this.domain
    //headers: this.headers
  };

  var proxyReq = https.request(opts, function(proxyRes) {
    response.writeHead(proxyRes.statusCode, proxyRes.headers);

    proxyRes.on("data", function(chunk) {
      response.write(chunk.toString());
    });
    proxyRes.on("end", function() {
      response.end();
    });
  });

  request.on("data", function(chunk) {
    params += chunk.toString();
    proxyReq.write(chunk.toString());
  });

  request.on("end", function() {
    var parsedParams;
    try {
      parsedParams = JSON.parse(params);
      log.silly(parsedParams,"params");
    }
    catch(e) {
      log.silly(params,"params");
    }
    proxyReq.end();
  });

};



// local act handler
// handles act request locally
function LocalActHandler(options) {
  options = options || {};
  ActHandler.call(this, options);

  this.cloud = options.cloud || "./cloud/";
  this.main = options.main || "main.js";
  this.watch = options.watch !== undefined ? options.watch : true;
  this.env = null;
  this.legacy = false;
  this.init();

  if(this.watch) {
    this.listenTo(this.cloud);
  }
}
util.inherits(LocalActHandler, ActHandler);

LocalActHandler.prototype.handleFileSystemChange = function(e, filename) {
  this.init();
};

LocalActHandler.prototype.init = function() {
  var env;

  console.log("loading cloud code...");

  try {
    var cloudPath = require.resolve(path.join(process.cwd(), this.cloud, this.main));
    delete require.cache[cloudPath];
    env = require(cloudPath);

    if(!Object.keys(env).length) {
      throw new Error("Looks like you didn't export any functions. Is this a rhino app?");
    }
    if(env) {
      this.env = env;
      log.info("cloud code loaded...");
    }
  }
  catch(e) {
    if(this.env) {
      //we have an environment loaded but we got an error trying to reload
      log.error("Failed to reload environment, using current version");
      log.error(e);
    }
    else {
      throw e;
    }
  }
};

LocalActHandler.prototype.handleRequest = function(request, response) {
  var self = this,
    uri = request.url,
    uriComponents = uri.split("/"),
    paramString = "",
    act = uriComponents[uriComponents.length - 2];

  log.silly("Handling act request locally");
  log.silly(uri, "url");
  log.silly(act, "act");

  request.on("data", function(chunk) {
    paramString += chunk.toString();
  });

  request.on("end", function() {
    var params;

    try  {
      self.act(act, JSON.parse(paramString), function(err, res) {
        if(err) {
          self.handleError(err, response);
        }
        else {
          self.doResponse(res, response);
        }
      });
    }
    catch(e) {
      return self.handleError(e, response);
    }

  });
};

LocalActHandler.prototype.handleError = function(err, response) {
  this.doResponse({
    status: "error",
    message: err.message
  }, response);
};

LocalActHandler.prototype.doResponse = function(data, response) {
  response.end(JSON.stringify(data));
};

LocalActHandler.prototype.act = function(act, params, cb) {
  log.silly(params, "params");
  try {
    this.env[act](params, cb);
  }
  catch(e) {
    cb(e);
  }
};




// static file handler
// handles searching through package directories and
// writing files
function StaticHandler(options) {
  options = options || {};
  RequestHandler.call(this, options);

  this.index = options.main || "index.html";

  initParams.widget.guid = this.guid;
  initParams.widget.instance = this.guid;
  initParams.domain = this.subDomain;

  this.packages = (options.packages || []).concat("default","../shared");
}
util.inherits(StaticHandler, RequestHandler);

StaticHandler.prototype.canHandle = function(request) {
  return request.method === "GET";
};

StaticHandler.prototype.handleRequest = function(request, response) {
  var self = this,
    requestParams = url.parse(request.url, true),
    uri = requestParams.pathname;


  this.getPackageFile(uri, function(exists, filename) {
    if(!exists) {
      return response.writeError(404, "Not Found");
    }

    fs.readFile(filename, "binary", function(err, file) {
      if(err) {
        return response.writeError(500, err);
      }

      response.writeHead(200, {
        "content-type": mimeTypes[filename.split(".").pop()] || mimeTypes.txt
      });

      if(filename.indexOf(self.index) >= 0) {
        response.end(self.buildIndex(file, requestParams.query));
      }
      else {
        response.end(file, "binary");
      }
    });
  });
};

StaticHandler.prototype.getPackageFile = function(uri, cb) {
  var lookupIndex = 0,
    packages = this.packages,
    self = this;

  (function checkNextPath() {
    var filename = path.join(process.cwd(), "client", packages[lookupIndex++], uri);

    fs.exists(filename, function(exists) {
      if(!exists) {//try the next one
        if(lookupIndex >= packages.length) {
          cb && cb(false);
        }
        else {
          checkNextPath();
        }
      }
      else if (fs.statSync(filename).isDirectory()) {
        //special case for directories
        //check is index.html available
        uri += '/' + self.index;
        lookupIndex--;
        checkNextPath();
      }
      else {
        cb && cb(true, filename);
      }
    });
  })();

};

StaticHandler.prototype.buildIndex = function(file, requestQuery) {
  var html = new Element("html"),
    head = new Element("head"),
    body = new Element("body"),
    initScript = new Element("script"),
    apiScript = new Element("script"),
    contentType = new Element("meta");

  contentType.setAttribute("http-equiv", "Content-Type" );
  contentType.setAttribute("content", "text/html; charset=utf-8");
  head.append(contentType);


  if(requestQuery.device !== undefined && requestQuery.version !== undefined) {
    var viewport = new Element("meta");
    viewport.setAttribute("name", "viewport");
    viewport.setAttribute("content", "width=device-width, height=device-height, user-scalable=no");
    apiScript.setAttribute("src", "http://" +
      this.domain + "/static/mac/script/" +
      requestQuery.device + "_" +
      requestQuery.version + "/167-scripts.js");

    head.append(viewport);
  }
  else {
    apiScript.setAttribute("src", "https://" + this.domain + "/static/pec/script/studio/155-scripts.js");
  }

  initScript.append("$fhclient = $fh.init(" + JSON.stringify(initParams) + ");");

  body.setAttribute("style", "margin:0px;padding:0px;");

  head.append(apiScript);
  head.append(initScript);
  body.append(file);
  html.append(head);
  html.append(body);

  return "<!doctype html>" + html.toString();
};


//used for creating html files
function Element(tag) {
  this.tag = tag;
  this.children = [];
  this.attributes = {};
}

Element.prototype.append = function(child) {
  this.children.push(child);
};

Element.prototype.setAttribute = function(key, value) {
  this.attributes[key] = value;
};

Element.prototype.toString = function() {
  var attributes = this.attributes,
    children = this.children,
    tag = this.tag,
    string = "<" + tag;

  for(var key in attributes) {
    string += " " + key + "=\"" + attributes[key] + "\"";
  }
  string += ">" + children.join("") + "</" + tag + ">";

  return string;
};