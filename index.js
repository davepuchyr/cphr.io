const express = require('express');
const crypto = require('crypto');
const bodyParser = require('body-parser');
const cors = require('cors');
const web3 = require('./eth.min').web3;
const Switch = require('libp2p-switch');
const createNode = require('./p2p').createNode;
const genPassPhrase = require('./p2p').genPassPhrase;
const getPassPhrase = require('./p2p').getPassPhrase;
const Tx = require('ethereumjs-tx');
const pull = require('pull-stream');
const app = express();
const port = process.env.PORT;

createNode((err, node) => {
  console.log(node.peerInfo.id.toB58String());

  node.on('peer:discovery', peer => {
    node.dial(peer, () => {});
  });
  node.on('peer:connect', peer => {
    // console.log(`connected: ${peer.id.toB58String()}`);
    node.peerBook.put(peer);
  });
  const swtch = node.switch;
  swtch.handle('/genesis', (protocol, conn) => {
    pull(
      conn,
      pull.collect((err, cipher) => {
        node.cipher = cipher.toString();
      })
    );
  });
  swtch.handle('/exchange', (protocol, conn) => {
    console.log(node.cipher);
  });

  // After implementing ZkSnark's algorithm,
  // this JSON will be unnecessary
  let params = {
    algorithm: 'aes256',
    inputEncoding: 'utf8',
    outputEncoding: 'hex',
    key: ''
  };

  app.use(express.static(__dirname + '/public'));

  app.use(bodyParser.json());
  app.use(
    bodyParser.urlencoded({
      extended: true
    })
  );

  app.use(
    cors({
      origin: (origin, callback) => {
        if (true) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      },
      credentials: true
    })
  );

  app.get('/check/:address', (req, res) => {
    getPassPhrase(req.params.address, node, swtch);
  });

  app.get('/connect/:address', (req, res) => {
    genPassPhrase(req.params.address, node, swtch);
  });

  app.post('/', (req, res) => {
    let { receiver, message } = req.body;
    web3.eth.getBlock('latest', (error, result) => {
      if (error) throw error;
      let randomBlock = parseInt(Math.random() * parseInt(result.number));
      web3.eth.getBlock(randomBlock).then(block => {
        params.key = block.hash;
        let cipher = crypto.createCipher(params.algorithm, params.key);
        let ciphered = cipher.update(
          message,
          params.inputEncoding,
          params.outputEncoding
        );
        ciphered += cipher.final(params.outputEncoding);
        ciphered = '' + randomBlock + '*' + ciphered;
        const privateKey = new Buffer(process.env.PRIVATE_KEY, 'hex');
        web3.eth.getTransactionCount(web3.eth.defaultAccount).then(nonce => {
          let txParams = {
            nonce: web3.utils.toHex('' + nonce++),
            gasPrice: web3.utils.toHex('1000000000'), // this price works: '0x028fa6ae00',
            gasLimit: web3.utils.toHex('30000'), // this limit works: '0xa028',
            to: receiver,
            form: web3.eth.defaultAccount,
            value: '0x0',
            data: web3.utils.toHex(ciphered),
            chainId: 1
          };
          let tx = new Tx(txParams);
          tx.sign(privateKey);
          let stx = tx.serialize();
          web3.eth
            .sendSignedTransaction('0x' + stx.toString('hex'))
            .on('transactionHash', hash => {
              res.json({
                success: true,
                hash: hash
              });
            });
        });
      });
    });
  });

  app.post('/enc', (req, res) => {
    let { message } = req.body;
    web3.eth.getBlock('latest', (error, result) => {
      if (error) throw error;
      let randomBlock = parseInt(Math.random() * parseInt(result.number));
      web3.eth.getBlock(randomBlock).then(block => {
        params.key = block.hash;
        let cipher = crypto.createCipher(params.algorithm, params.key);
        let ciphered = cipher.update(
          message,
          params.inputEncoding,
          params.outputEncoding
        );
        ciphered += cipher.final(params.outputEncoding);
        ciphered = '' + randomBlock + '*' + ciphered;
        res.json({
          success: true,
          encoded: ciphered
        });
      });
    });
  });

  app.post('/dec', (req, res) => {
    let { encoded } = req.body;
    params.key = encoded.split('*')[0];
    encoded = encoded.split('*')[1];
    web3.eth.getBlock(params.key).then(block => {
      var decipher = crypto.createDecipher(params.algorithm, block.hash);
      var deciphered = decipher.update(
        encoded,
        params.outputEncoding,
        params.inputEncoding
      );
      deciphered += decipher.final(params.inputEncoding);
      res.json({
        success: true,
        message: deciphered
      });
    });
  });

  app.listen(port, () => {
    console.log(`Example app listening on port ${port}!`);
  });
});
