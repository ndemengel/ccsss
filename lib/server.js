'use strict';

const http = require('http');
const httpRequest = require('request');
const CriticalCssGenerator = require('./generator');

const EXAMPLE_OF_VALID_REQUEST = {
    "url": "http://mywebsite.org/some/page",
    "notificationUrl": "http://mywebsite.org/notification/critical-css-ready",
    "dimensions": [{
        "width": 1280,
        "height": 800
    }, {
        "width": 320,
        "height": 568
    }]
};
const GENERATION_RESULT_PATH = '/generation/result/';

let generator = new CriticalCssGenerator();
let results = {};


generator.on('critical-css-generated', (cfg, criticalCss) => {
    results[cfg.generationId] = criticalCss;

    if (cfg.notificationUrl) {
        httpRequest({
            method: 'POST',
            uri: cfg.notificationUrl,
            json: {
                generationId: cfg.generationId,
                status: 'success',
                resultLocation: cfg.resultEndpoint + cfg.generationId
            }
        }, (err, response) => {
            if (err) {
                return console.error(err);
            }
            if (response.statusCode !== 200) {
                console.error(`Received status ${response.statusCode} from notification URL ${cfg.notificationUrl}`);
            }
        });
    }
});

function isValidDimension(dim) {
    return typeof dim === 'object' && typeof dim.width === 'number' && typeof dim.height === 'number';
}

function isValidUrl(url) {
    return typeof url === 'string' && url.match(/^https?:\/\//);
}

function isValidGenerationRequest(cfg) {
    if (!isValidUrl(cfg.url)) {
        return false;
    }
    if (!Array.isArray(cfg.dimensions) || !cfg.dimensions.every(isValidDimension)) {
        return false;
    }
    return typeof cfg.notificationUrl === 'undefined' || isValidUrl(cfg.notificationUrl);
}

function acceptGenerationRequestIfValid(req, response) {
    if (req.method !== 'POST') {
        return methodNotAllowed(response);
    }

    let body = [];
    req.on('data', chunk => {
        body.push(chunk);
    });
    req.on('end', () => {
        try {
            let cfg = JSON.parse(Buffer.concat(body).toString());
            if (!isValidGenerationRequest(cfg)) {
                response.writeHead(400, {'Content-Type': 'application/json'});
                response.end(JSON.stringify({exampleOfValidRequest: EXAMPLE_OF_VALID_REQUEST}));
                return;
            }

            let resultEndpoint = 'http://' + req.headers.host + GENERATION_RESULT_PATH;
            cfg.resultEndpoint = resultEndpoint;

            let generationId = generator.enqueue(cfg);

            response.writeHead(202, {
                'Content-Type': 'application/json',
                'Location': resultEndpoint + generationId
            });
            response.end(JSON.stringify({
                generationId: generationId,
                status: 'pending'
            }));
        } catch (e) {
            console.error(e);
            response.statusCode = 500;
            response.end();
        }
    });
}

function tryToServeResult(req, response) {
    if (req.method !== 'GET') {
        return methodNotAllowed(response);
    }

    let generationId = req.url.substr(GENERATION_RESULT_PATH.length);

    if (!(generationId in results)) {
        return notFound(response);
    }

    response.writeHead(200, {'Content-Type': 'text/css'});
    response.end(results[generationId]);
    delete results[generationId];
}

function methodNotAllowed(response) {
    response.statusCode = 405;
    response.end('Method not allowed');
}

function notFound(response) {
    response.statusCode = 404;
    response.end('Not found');
}


let server = http.createServer((req, response) => {
    req.on('error', err => {
        console.error((new Date).toUTCString() + ':', err.message);
        console.error(err.stack);
    });
    response.on('error', err => {
        console.error((new Date).toUTCString() + ':', err.message);
        console.error(err.stack);
    });

    try {
        if (req.url === '/generation/request') {
            acceptGenerationRequestIfValid(req, response);
        } else {
            if (req.url.startsWith(GENERATION_RESULT_PATH)) {
                tryToServeResult(req, response);
            } else {
                notFound(response);
            }
        }
    } catch (e) {
        console.error(e);
    }
});

module.exports.start = (port, maybeCallback) => {
    server.listen(port, () => {
        console.log('ccsss listening on port ' + port);
        if (typeof maybeCallback === 'function') {
            maybeCallback();
        }
    });

    return {
        stop: server.close.bind(server)
    }
};
