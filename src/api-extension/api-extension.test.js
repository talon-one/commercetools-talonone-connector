'use strict';
const {
  emptyEvent,
  createCartEvent,
  createCartWithItemsEvent,
  updateCartEvent,
  createCustomerEvent,
  updateCustomerEvent,
  createOrderEvent,
  updateOrderEvent,
  updateCartActions,
  updateCustomerSessionResponse,
  updateCartEventCustomerSession,
  createCartReferralActions,
  createCustomerReferralActions,
  eurReferralsResponse,
  usdReferralsResponse,
  createCartUpdateCustomerReferralActions,
  updateCartWithCouponEvent,
  updateCustomerSessionWithCouponResponse,
  updateCartWithCouponActions,
  updateCustomerSessionWithoutCouponResponse,
  updateCartWithoutCouponEvent,
  updateCartWithoutCouponActions,
  updateCartWithPerItemDiscountActions,
  updateCustomerSessionWithPerItemDiscountResponse,
} = require('./mocks');
const { CloudProvider } = require('./models/cloud-provider');
const { GoogleTestWrapper } = require('./models/google-test-wrapper');

const jestPlugin = require('serverless-jest-plugin');
const { Money } = require('./models');
const { MoneyType } = require('./models/money-type');

function setupEnv(env = {}) {
  process.env.UNIT_TEST = '1';
  process.env.LOGGER_MODE = 'NONE';
  process.env.TALON_ONE_ATTRIBUTES_MAPPINGS = '{"customerProfile":{"mappings":{"name":"Name"}}}';
  process.env.LANGUAGE = 'en';
  process.env.DISCOUNT_TAX_CATEGORY_ID = '3b52cdd8-c767-4c98-923f-a269e01a6ff2';
  process.env.SKU_TYPE = 'CTP_VARIANT_SKU';
  process.env.SKU_SEPARATOR = '@';
  process.env.VERIFY_PRODUCT_IDENTIFIERS = '1';
  process.env.VERIFY_TAX_IDENTIFIERS = '0';
  process.env.PAY_WITH_POINTS_ATTRIBUTE_NAME = '';
  process.env.CUSTOMER_SESSION_MOCK = undefined;
  process.env.PROFILE_EUR_MOCK = undefined;
  process.env.PROFILE_USD_MOCK = undefined;
  process.env.SESSION_USD_MOCK = undefined;
  process.env.SESSION_EUR_MOCK = undefined;
  process.env.__REQUEST = undefined;
  process.env.__CUSTOMER_UPDATE_ACTIONS = undefined;
  process.env.CTP_LINE_ITEM_METADATA_TYPE_KEY = 'talon_one_line_item_metadata';
  process.env.CTP_CART_METADATA_TYPE_KEY = 'talon_one_cart_metadata';
  process.env.CTP_CUSTOMER_METADATA_TYPE_KEY = 'talon_one_customer_metadata';
  process.env = { ...process.env, ...env };

  jest.resetModules();
  const mod = require('./index');

  switch (process.env.PROVIDER) {
    case CloudProvider.AWS:
      return jestPlugin.lambdaWrapper.wrap(mod, { handler: 'handler' });

    case CloudProvider.GCP:
      return new GoogleTestWrapper(mod);

    default:
      throw new Error('Invalid provider.');
  }
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function reindex(array) {
  return array.filter((val) => val);
}

const matrix = [
  {
    PROVIDER: 'google',
    GCP_PROJECT: 'fake',
    GCP_CREDENTIALS: 'fake',
    BASIC_AUTH_USERNAME: 'fake',
    BASIC_AUTH_PASSWORD: 'fake',
  },
  {
    PROVIDER: 'aws',
    GCP_PROJECT: undefined,
    GCP_CREDENTIALS: undefined,
    BASIC_AUTH_USERNAME: undefined,
    BASIC_AUTH_PASSWORD: undefined,
  },
];

for (const env of matrix) {
  describe(`[${env.PROVIDER}] api-extension`, () => {
    it('create cart event', () => {
      return setupEnv(env)
        .run(createCartEvent)
        .then((response) => {
          expect(response).toBeDefined();
        });
    });

    it('update cart event', () => {
      const out = deepClone(updateCartActions);
      delete out.actions[0];
      out.actions = reindex(out.actions);

      return setupEnv(env)
        .run(updateCartEvent)
        .then((response) => {
          expect(response).toBeDefined();
          expect(response).toEqual(out);
        });
    });

    it('update cart with per item discount event', () => {
      const out = deepClone(updateCartWithPerItemDiscountActions);

      return setupEnv({
        CUSTOMER_SESSION_MOCK: updateCustomerSessionWithPerItemDiscountResponse,
        ...env,
      })
        .run(createCartWithItemsEvent)
        .then((response) => {
          expect(response).toBeDefined();
          expect(response).toEqual(out);
        });
    });

    it('update cart event with external custom types', () => {
      const out = deepClone(updateCartActions);
      delete out.actions[0];
      out.actions = reindex(out.actions);

      out.actions[0].type.key = 'test_2';
      [5, 6, 7, 8, 9, 11].forEach((v) => (out.actions[v].custom.type.key = 'test_1'));

      return setupEnv({
        CTP_LINE_ITEM_METADATA_TYPE_KEY: 'test_1',
        CTP_CART_METADATA_TYPE_KEY: 'test_2',
        ...env,
      })
        .run(updateCartEvent)
        .then((response) => {
          expect(response).toEqual(out);
        });
    });

    it('update cart event with CTP_PRODUCT_ID', () => {
      const session = deepClone(updateCustomerSessionResponse);
      session.effects[2].props.sku = 'e47852f8-9044-483d-84dd-8c42eb493378';
      session.effects[3].props.sku = 'e47852f8-9044-483d-84dd-8c42eb493378';
      session.effects[4].props.sku = 'e47852f8-9044-483d-84dd-8c42eb493378';

      const out = deepClone(updateCartActions);
      delete out.actions[0];
      delete out.actions[8];
      delete out.actions[12].sku;
      out.actions[12].productId = 'e47852f8-9044-483d-84dd-8c42eb493378';
      out.actions[12].quantity = 3;
      out.actions = reindex(out.actions);

      return setupEnv({
        SKU_TYPE: 'CTP_PRODUCT_ID',
        CUSTOMER_SESSION_MOCK: session,
        ...env,
      })
        .run(updateCartEvent)
        .then((response) => {
          expect(response).toEqual(out);
        });
    });

    it('update cart event with CTP_PRODUCT_ID_WITH_VARIANT_ID (1)', () => {
      const session = deepClone(updateCustomerSessionResponse);
      session.effects[2].props.sku = 'e47852f8-9044-483d-84dd-8c42eb493378';
      session.effects[3].props.sku = 'e47852f8-9044-483d-84dd-8c42eb493378';
      session.effects[4].props.sku = 'e47852f8-9044-483d-84dd-8c42eb493378';

      const out = deepClone(updateCartActions);
      delete out.actions[0];
      delete out.actions[8];
      delete out.actions[12].sku;
      out.actions[12].productId = 'e47852f8-9044-483d-84dd-8c42eb493378';
      out.actions[12].variantId = 1;
      out.actions[12].quantity = 3;
      out.actions = reindex(out.actions);

      return setupEnv({
        SKU_TYPE: 'CTP_PRODUCT_ID_WITH_VARIANT_ID',
        CUSTOMER_SESSION_MOCK: session,
        ...env,
      })
        .run(updateCartEvent)
        .then((response) => {
          expect(response).toEqual(out);
        });
    });

    it('update cart event with CTP_PRODUCT_ID_WITH_VARIANT_ID (2)', () => {
      const session = deepClone(updateCustomerSessionResponse);
      session.effects[2].props.sku = 'e47852f8-9044-483d-84dd-8c42eb493378@2';
      session.effects[3].props.sku = 'e47852f8-9044-483d-84dd-8c42eb493378@2';
      session.effects[4].props.sku = 'e47852f8-9044-483d-84dd-8c42eb493378@1';

      const out = deepClone(updateCartActions);
      delete out.actions[0];
      delete out.actions[8].sku;
      delete out.actions[12].sku;
      out.actions[8].productId = 'e47852f8-9044-483d-84dd-8c42eb493378';
      out.actions[8].variantId = 1;
      out.actions[12].productId = 'e47852f8-9044-483d-84dd-8c42eb493378';
      out.actions[12].variantId = 2;
      out.actions = reindex(out.actions);

      return setupEnv({
        SKU_TYPE: 'CTP_PRODUCT_ID_WITH_VARIANT_ID',
        CUSTOMER_SESSION_MOCK: session,
        ...env,
      })
        .run(updateCartEvent)
        .then((response) => {
          expect(response).toEqual(out);
        });
    });

    it('update cart event without notifications', () => {
      const session = deepClone(updateCustomerSessionResponse);
      for (let i = 5; i <= 12; i++) {
        delete session.effects[i];
      }

      session.effects = reindex(session.effects);

      const out = deepClone(updateCartActions);
      [9, 10, 1].map((i) => delete out.actions[i]);
      out.actions = reindex(out.actions);

      return setupEnv({
        CUSTOMER_SESSION_MOCK: session,
        ...env,
      })
        .run(updateCartEvent)
        .then((response) => {
          expect(response).toBeDefined();
          expect(response).toEqual(out);
        });
    });

    it('update cart event with invalid effects', () => {
      const session = deepClone(updateCustomerSessionResponse);
      for (let i = 5; i <= 12; i++) {
        delete session.effects[i];
      }

      const out = deepClone(updateCartActions);
      [9, 10, 1].map((i) => delete out.actions[i]);
      out.actions = reindex(out.actions);

      return setupEnv({
        CUSTOMER_SESSION_MOCK: session,
        ...env,
      })
        .run(updateCartEvent)
        .then((response) => {
          expect(response).toBeDefined();
          expect(response).toEqual(out);
        });
    });

    it('update cart event with tax verification', () => {
      const session = deepClone(updateCustomerSessionResponse);
      for (let i = 5; i <= 12; i++) {
        delete session.effects[i];
      }

      return setupEnv({
        CUSTOMER_SESSION_MOCK: session,
        VERIFY_TAX_IDENTIFIERS: 1,
        ...env,
      })
        .run(updateCartEvent)
        .then((response) => {
          expect(response).toBeDefined();
          expect(response).toEqual({ actions: [], responseType: 'UpdateRequest' });
        });
    });

    it('create customer event', () => {
      return setupEnv(env)
        .run(createCustomerEvent)
        .then((response) => {
          expect(response).toStrictEqual({ actions: [], responseType: 'UpdateRequest' });
        });
    });

    it('update customer event', () => {
      return setupEnv(env)
        .run(updateCustomerEvent)
        .then((response) => {
          expect(response).toBeDefined();
        });
    });

    it('create order event', () => {
      return setupEnv(env)
        .run(createOrderEvent)
        .then((response) => {
          expect(response).toBeDefined();
        });
    });

    it('update order event', () => {
      return setupEnv(env)
        .run(updateOrderEvent)
        .then((response) => {
          expect(response).toBeDefined();
        });
    });

    it('empty event', () => {
      return setupEnv(env)
        .run(emptyEvent)
        .then((response) => {
          expect(response).toBeDefined();
        });
    });

    it('api credentials without currency fallback', () => {
      const out = deepClone(updateCartActions);
      for (let i = 6; i <= 12; i++) {
        delete out.actions[i];
      }
      delete out.actions[1];
      out.actions = reindex(out.actions);

      return setupEnv({
        TALON_ONE_FALLBACK_CURRENCY: '',
        TALON_ONE_API_KEY_V1_USD: 'fake-key',
        TALON_ONE_API_BASE_PATH_USD: 'fake-path',
        TALON_ONE_API_KEY_V1_EUR: undefined,
        TALON_ONE_API_BASE_PATH_EUR: undefined,
        ...env,
      })
        .run(updateCartEvent)
        .then((response) => {
          const { LoggerService } = require('./services/logger');
          const logger = new LoggerService();
          expect(response).toEqual(out);
          expect(logger.getLastError().message).toEqual('Invalid currency code.');
        });
    });

    // it('api credentials with currency fallback', () => {
    //   const out = deepClone(updateCartActions);
    //   for (let i = 6; i <= 12; i++) {
    //     delete out.actions[i];
    //   }
    //   delete out.actions[1];
    //   out.actions = reindex(out.actions);
    //
    //   return setupEnv({
    //     UNIT_TEST: 0,
    //     TALON_ONE_FALLBACK_CURRENCY: 'USD',
    //     TALON_ONE_API_KEY_V1_USD: 'fake-key',
    //     TALON_ONE_API_BASE_PATH_USD: 'fake-path',
    //     TALON_ONE_API_KEY_V1_EUR: undefined,
    //     TALON_ONE_API_BASE_PATH_EUR: undefined,
    //     ...env
    //   })
    //     .run(updateCartEvent)
    //     .then((response) => {
    //       const { LoggerService } = require('./services/logger');
    //       const logger = new LoggerService();
    //       expect(response).toEqual(out);
    //       expect(logger.getLastError().error.message).toEqual('getaddrinfo ENOTFOUND fake-path');
    //     });
    // });

    it('create customer event with referrals', () => {
      return setupEnv({
        TALON_ONE_API_KEY_V1_EUR: 'EUR',
        TALON_ONE_API_BASE_PATH_EUR: 'EUR',
        TALON_ONE_API_KEY_V1_USD: 'USD',
        TALON_ONE_API_BASE_PATH_USD: 'USD',
        PROFILE_USD_MOCK: usdReferralsResponse,
        PROFILE_EUR_MOCK: eurReferralsResponse,
        ...env,
      })
        .run(createCustomerEvent)
        .then((response) => {
          expect(response).toEqual(createCustomerReferralActions);
        });
    });

    it('create customer event with referrals with external custom types', () => {
      const out = deepClone(createCustomerReferralActions);
      out.actions[0].type.key = 'test_3';

      return setupEnv({
        TALON_ONE_API_KEY_V1_EUR: 'EUR',
        TALON_ONE_API_BASE_PATH_EUR: 'EUR',
        TALON_ONE_API_KEY_V1_USD: 'USD',
        TALON_ONE_API_BASE_PATH_USD: 'USD',
        PROFILE_USD_MOCK: usdReferralsResponse,
        PROFILE_EUR_MOCK: eurReferralsResponse,
        CTP_CUSTOMER_METADATA_TYPE_KEY: 'test_3',
        ...env,
      })
        .run(createCustomerEvent)
        .then((response) => {
          expect(response).toEqual(out);
        });
    });

    it('create cart event with referrals', () => {
      return setupEnv({
        TALON_ONE_API_KEY_V1_EUR: 'EUR',
        TALON_ONE_API_BASE_PATH_EUR: 'EUR',
        TALON_ONE_API_KEY_V1_USD: 'USD',
        TALON_ONE_API_BASE_PATH_USD: 'USD',
        SESSION_USD_MOCK: usdReferralsResponse,
        SESSION_EUR_MOCK: eurReferralsResponse,
        ...env,
      })
        .run(createCartEvent)
        .then((response) => {
          expect(response).toEqual(createCartReferralActions);
          expect(JSON.parse(process.env.__CUSTOMER_UPDATE_ACTIONS)).toEqual(
            createCartUpdateCustomerReferralActions
          );
        });
    });

    it('create cart event with referrals and external custom types', () => {
      const out1 = deepClone(createCartReferralActions);
      out1.actions[0].type.key = 'test_2';

      const out2 = deepClone(createCartUpdateCustomerReferralActions);
      out2[0].type.key = 'test_3';

      return setupEnv({
        TALON_ONE_API_KEY_V1_EUR: 'EUR',
        TALON_ONE_API_BASE_PATH_EUR: 'EUR',
        TALON_ONE_API_KEY_V1_USD: 'USD',
        TALON_ONE_API_BASE_PATH_USD: 'USD',
        SESSION_USD_MOCK: usdReferralsResponse,
        SESSION_EUR_MOCK: eurReferralsResponse,
        CTP_CART_METADATA_TYPE_KEY: 'test_2',
        CTP_CUSTOMER_METADATA_TYPE_KEY: 'test_3',
        ...env,
      })
        .run(createCartEvent)
        .then((response) => {
          expect(response).toEqual(out1);
          expect(JSON.parse(process.env.__CUSTOMER_UPDATE_ACTIONS)).toEqual(out2);
        });
    });

    it('data mapping', () => {
      return setupEnv({
        CART_ATTRIBUTE_MAPPING:
          'color.label:t1_01{dates}; color.label.x5:t1_02{time}; color.label.x3:t1_03{location}; color.label:t1_04{locations}; color.key:t1_05{numbers}; color.label:t1_06{numbers}; color.label.x0:t1_07{number}; color.label.x7:t1_08{boolean}; color.key:t1_09; color.label:t1_10{strings}; color.label{it,de}:t1_11{strings}; color.label{de,it}:t1_12{strings}; color.label.de:t1_13; color:t1_14; color.label.x3.x:t1_15',
        CART_ITEM_ATTRIBUTE_MAPPING:
          'color.label:t1_01{dates}; color.label.x5:t1_02{time}; color.label.x3:t1_03{location}; color.label:t1_04{locations}; color.key:t1_05{numbers}; color.label:t1_06{numbers}; color.label.x0:t1_07{number}; color.label.x7:t1_08{boolean}; color.key:t1_09; color.label:t1_10{strings}; color.label{it,de}:t1_11{strings}; color.label{de,it}:t1_12{strings}; color.label.de:t1_13; color:t1_14; color.label.x3.x:t1_15',
        ...env,
      })
        .run(updateCartEvent)
        .then(() => {
          expect(process.env.__REQUEST.context.customerSessionV2).toEqual(
            updateCartEventCustomerSession
          );
        });
    });

    it('pay with points - false', () => {
      const out = deepClone(updateCartEventCustomerSession);
      out.payload.attributes.PayWithPoints = false;

      return setupEnv({
        PAY_WITH_POINTS_ATTRIBUTE_NAME: 'PayWithPoints',
        ...env,
      })
        .run(updateCartEvent)
        .then(() => {
          expect(process.env.__REQUEST.context.customerSessionV2).toEqual(out);
        });
    });

    it('update cart event with coupon code', () => {
      return setupEnv({
        CUSTOMER_SESSION_MOCK: updateCustomerSessionWithCouponResponse,
        ...env,
      })
        .run(updateCartWithCouponEvent)
        .then((response) => {
          expect(response).toEqual(updateCartWithCouponActions);
        });
    });

    it('update cart event without coupon code', () => {
      return setupEnv({
        CUSTOMER_SESSION_MOCK: updateCustomerSessionWithoutCouponResponse,
        ...env,
      })
        .run(updateCartWithoutCouponEvent)
        .then((response) => {
          expect(response).toEqual(updateCartWithoutCouponActions);
        });
    });

    it('rounds correctly', () => {
      process.env.ROUNDING_MODE = 'ROUND_HALF_EVEN';

      expect(
        new Money(MoneyType.CENT_PRECISION, 'EUR', 9999)
          .subtract(
            new Money(MoneyType.DECIMAL_PRECISION, 'EUR', 16.9983),
            MoneyType.DECIMAL_PRECISION
          )
          .getCentAmount()
      ).toEqual(8299);

      expect(
        new Money(MoneyType.CENT_PRECISION, 'EUR', 1000)
          .subtract(
            new Money(MoneyType.DECIMAL_PRECISION, 'EUR', 0.009),
            MoneyType.DECIMAL_PRECISION
          )
          .getCentAmount()
      ).toEqual(999);

      expect(
        new Money(MoneyType.CENT_PRECISION, 'EUR', 1000)
          .subtract(
            new Money(MoneyType.DECIMAL_PRECISION, 'EUR', 0.005),
            MoneyType.DECIMAL_PRECISION
          )
          .getCentAmount()
      ).toEqual(1000);

      expect(
        new Money(MoneyType.CENT_PRECISION, 'EUR', 1000)
          .subtract(
            new Money(MoneyType.DECIMAL_PRECISION, 'EUR', 0.015),
            MoneyType.DECIMAL_PRECISION
          )
          .getCentAmount()
      ).toEqual(998);

      process.env.ROUNDING_MODE = 'ROUND_HALF_UP';

      expect(
        new Money(MoneyType.CENT_PRECISION, 'EUR', 1000)
          .subtract(
            new Money(MoneyType.DECIMAL_PRECISION, 'EUR', 0.005),
            MoneyType.DECIMAL_PRECISION
          )
          .getCentAmount()
      ).toEqual(1000);

      expect(
        new Money(MoneyType.CENT_PRECISION, 'EUR', 1000)
          .subtract(
            new Money(MoneyType.DECIMAL_PRECISION, 'EUR', 0.015),
            MoneyType.DECIMAL_PRECISION
          )
          .getCentAmount()
      ).toEqual(999);

      process.env.ROUNDING_MODE = 'ROUND_HALF_DOWN';

      expect(
        new Money(MoneyType.CENT_PRECISION, 'EUR', 1000)
          .subtract(
            new Money(MoneyType.DECIMAL_PRECISION, 'EUR', 0.005),
            MoneyType.DECIMAL_PRECISION
          )
          .getCentAmount()
      ).toEqual(999);

      expect(
        new Money(MoneyType.CENT_PRECISION, 'EUR', 1000)
          .subtract(
            new Money(MoneyType.DECIMAL_PRECISION, 'EUR', 0.015),
            MoneyType.DECIMAL_PRECISION
          )
          .getCentAmount()
      ).toEqual(998);

      expect(new Money(MoneyType.DECIMAL_PRECISION, 'EUR', 16.83).getCentAmount()).toEqual(1683);
    });
  });
}
