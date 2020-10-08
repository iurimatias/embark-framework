/*global artifacts, describe, config, it, web3*/
const assert = require('assert');
const Token = artifacts.require('Token');
const MyToken = artifacts.require('MyToken');
const MyToken2 = artifacts.require('MyToken2');
const AlreadyDeployedToken = artifacts.require('AlreadyDeployedToken');
const Test = artifacts.require('Test');
const TestOnDeploy = artifacts.require('TestOnDeploy');
const SomeContract = artifacts.require('SomeContract');

config({
  namesystem: {
    enabled: true,
    register: {
      rootDomain: "embark.eth"
    }
  },
  contracts: {
    deploy: {
      ZAMyLib: {},
      SimpleStorage: {
        args: [100]
      },
      AnotherStorage: {
        args: ["$SimpleStorage"]
      },
      Token: {
        deploy: false,
        args: [1000]
      },
      MyToken: {
        instanceOf: "Token"
      },
      MyToken2: {
        instanceOf: "Token",
        args: [2000]
      },
      AlreadyDeployedToken: {
        address: "0xCAFECAFECAFECAFECAFECAFECAFECAFECAFECAFE",
        instanceOf: "Token"
      },
      Test: {
        onDeploy: ["Test.methods.changeAddress('$MyToken').send()", "Test.methods.changeENS('embark.eth').send()"]
      },
      TestOnDeploy: {
        instanceOf: "Test",
        onDeploy: async ({contracts, _web3, _logger}) => {
          await contracts.TestOnDeploy.methods.changeAddress(contracts.MyToken.options.address).send();
        },
        deps: ["MyToken"]
      },
      ContractArgs: {
        args: {
          initialValue: 123,
          _addresses: ["$MyToken2", "$SimpleStorage"]
        }
      },
      SomeContract: {
        deployIf: (dependencies) => {
          return dependencies.contracts.MyToken.methods.isAvailable().call();
        },
        args: [
          ["$MyToken2", "$SimpleStorage"],
          100
        ]
      }
    }
  }
});

describe("Token", function() {
  this.timeout(0);

  describe('Token Contract', function() {
    it("not deploy Token", function() {
      assert.strictEqual(Token.address, undefined);
    });
  });

  describe('MyToken Contracts', function() {
    it("should deploy MyToken and MyToken2", function() {
      assert.ok(MyToken.options.address);
      assert.ok(MyToken2.options.address);
    });

    it("set MyToken Balance correctly", async function() {
      const result = await MyToken.methods._supply().call();
      assert.strictEqual(parseInt(result, 10), 1000);
    });

    it("set MyToken2 Balance correctly", async function() {
      const result = await MyToken2.methods._supply().call();
      assert.strictEqual(parseInt(result, 10), 2000);
    });
  });

  describe('Other Contracts', function() {
    it("get right address", function() {
      assert.strictEqual(AlreadyDeployedToken.options.address.toLowerCase(),
        "0xCAFECAFECAFECAFECAFECAFECAFECAFECAFECAFE".toLowerCase());
    });

    it("should use onDeploy", async function() {
      const result = await Test.methods.addr().call();
      assert.strictEqual(result, MyToken.options.address);
    });

    it("should use onDeploy with function", async function() {
      const result = await TestOnDeploy.methods.addr().call();
      assert.strictEqual(result, MyToken.options.address);
    });

    it("should not deploy if deployIf returns false", function() {
      assert.ok(!SomeContract.options.address);
    });

    it("should set the ens attr to the address of embark.eth", async function() {
      const result = await Test.methods.ens().call();
      // Testing that it is an address as we don't really know the address
      assert.strictEqual(web3.utils.isAddress(result), true);
      assert.notStrictEqual(result, '0x0000000000000000000000000000000000000000');
    });
  });
});
