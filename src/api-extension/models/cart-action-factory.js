'use strict';
const slugify = require('slugify');
const { LoyaltyPoints } = require('./loyalty-points');
const { RemoveCustomLineItemBuilder } = require('./remove-custom-line-item-builder');
const { ChangeLineItemQuantityBuilder } = require('./change-line-item-quantity-builder');
const { ErrorNotification } = require('./notification');
const { InfoNotification } = require('./notification');
const { SetCustomTypeBuilder } = require('./set-custom-type-builder');
const { TalonOneCartMetadata } = require('./talon-one-cart-metadata');
const { AddLineItemBuilder } = require('./add-line-item-builder');
const { SetLineItemTotalPriceBuilder } = require('./set-line-item-total-price-builder');
const { TalonOneLineItemMetadata } = require('./talon-one-line-item-metadata');
const { AddCustomLineItemBuilder } = require('./add-custom-line-item-builder');
const { Money } = require('./money');
const { Notification } = require('./notification');
const { MoneyType } = require('./money-type');
const { SkuType } = require('./sku-type');
const { UpdateAction } = require('./update-action');
const {
  // eslint-disable-next-line no-unused-vars
  CustomerSessionV2,
} = require('talon_one');
const { EffectType } = require('./effect-type');
const { MapperSettings } = require('./mapper-settings');
const { TalonOneCustomerMetadata } = require('./talon-one-customer-metadata');

const PREPARE_CONTEXT_PIPE = '_prepareContext';
const BUILD_CUSTOM_TYPE_PIPE = '_buildCustomType';
const COMPACT_ADD_LINE_ITEM_ACTIONS_PIPE = '_compactAddLineItemActions';
const COMPACT_SET_LINE_ITEM_TOTAL_PRICE_PIPE = '_compactSetLineItemTotalPriceActions';
const RESET_PIPE = '_reset';
const PREFETCHING_PIPE = '_prefetching';
const VERIFY_FREE_ITEMS_PIPE = '_verifyFreeItems';
const VERIFY_TAX_IDS_PIPE = '_verifyTaxIds';
const UPDATE_CUSTOMER_PIPE = '_updateCustomer';
const EFFECTS_PIPE = '_effects';

const REFERRAL_CODE_SEPARATOR = '__';

/**
 * Creates Cart Update Actions based on Talon.One effects and shopping cart from commercetools.
 * @see https://docs.commercetools.com/api/projects/carts#update-actions
 */
class CartActionFactory {
  /**
   * Configures CartActionFactory.
   *
   * @param {MapperSettings} mapperSettings
   * @param {CtpCartEventResourceObject} cart
   * @param {CustomerSessionV2} talonSession
   * @param {string} currencyCode
   * @param {CtpLineItem[]} lineItems
   * @param {CtpCustomLineItem[]} customLineItems
   * @param {function(): CtpApiClientService} ctpApiClient
   * @param {LoggerService} logger
   * @param {Object} sessionLoyalty
   */
  constructor(
    mapperSettings,
    cart,
    talonSession,
    currencyCode,
    lineItems,
    customLineItems,
    ctpApiClient,
    logger,
    sessionLoyalty
  ) {
    if (!(mapperSettings instanceof MapperSettings)) {
      throw new Error('Invalid mapper settings type.');
    }

    this._cart = cart;
    this._talonSession = talonSession;
    this._currencyCode = currencyCode;
    this._lineItems = lineItems;
    this._customLineItems = customLineItems;
    this._ctpApiClient = ctpApiClient;
    this._logger = logger;
    this._sessionLoyalty = sessionLoyalty;

    /** @type {MapperSettings} */
    this._mapperSettings = mapperSettings;

    this._lang = this._mapperSettings.getLang();
    this._taxCategoryId = this._mapperSettings.getTaxCategoryId();
    this._skuType = this._mapperSettings.getSkuType();
    this._skuSeparator = this._mapperSettings.getSkuSeparator();
    this._verifyFreeItemsFlag = this._mapperSettings.getVerifyFreeItemsFlag();
    this._verifyTaxIdsFlag = this._mapperSettings.getVerifyTaxIdsFlag();

    this._context = {};

    this._customType = new SetCustomTypeBuilder(CartActionFactory.getInitialFields(cart));
    this._customType.cartType();

    this._slugIndex = 0;
  }

  /**
   * @param {CtpCartEventResourceObject} cart
   */
  static getInitialFields(cart) {
    let initialFields = {};

    if (cart?.custom?.fields) {
      initialFields = cart.custom.fields;
    }

    return initialFields;
  }

  /**
   * @param {any[]} effects
   * @param {any[]} [actions=[]]
   * @param {string[]} [pipes=[REFERRAL_CREATED_PIPE]]
   * @return {Promise<any[]>}
   */
  async createActions(
    effects,
    actions = [],
    pipes = [
      PREFETCHING_PIPE,
      PREPARE_CONTEXT_PIPE,
      EFFECTS_PIPE,
      COMPACT_ADD_LINE_ITEM_ACTIONS_PIPE,
      RESET_PIPE,
      COMPACT_SET_LINE_ITEM_TOTAL_PRICE_PIPE,
      VERIFY_FREE_ITEMS_PIPE,
      BUILD_CUSTOM_TYPE_PIPE,
      VERIFY_TAX_IDS_PIPE,
      UPDATE_CUSTOMER_PIPE,
    ]
  ) {
    for (const pipe of pipes) {
      try {
        const fn = this[pipe].bind(this);
        actions = await fn(effects, actions);
      } catch (e) {
        this._logger.error(e);
      }
    }

    return actions;
  }

  /**
   * @param {any[]} effects
   * @param {any[]} actions
   * @return {any[]}
   * @private
   */
  _effects(effects, actions) {
    for (const effect of effects) {
      try {
        switch (effect?.effectType) {
          case EffectType.setDiscount:
            actions = this._setDiscountEffect(effect, actions);
            break;

          case EffectType.setDiscountPerItem:
            actions = this._setDiscountPerItemEffect(effect, actions);
            break;

          case EffectType.addFreeItem:
            actions = this._addFreeItemEffect(effect, actions);
            break;

          case EffectType.showNotification:
            actions = this._showNotificationEffect(effect, actions);
            break;

          case EffectType.acceptCoupon:
            actions = this._acceptCouponEffect(effect, actions);
            break;

          case EffectType.rejectCoupon:
            actions = this._rejectCouponEffect(effect, actions);
            break;

          case EffectType.acceptReferral:
            actions = this._acceptReferralEffect(effect, actions);
            break;

          case EffectType.rejectReferral:
            actions = this._rejectReferralEffect(effect, actions);
            break;

          default:
            break;
        }
      } catch (e) {
        this._logger.error(e);
      }
    }

    return actions;
  }

  /**
   * @param {any} effect
   * @param {any[]} actions
   * @return {any[]}
   * @private
   */
  _setDiscountEffect(effect, actions) {
    if (!this._taxCategoryId) {
      this._logger.error('You must define DISCOUNT_TAX_CATEGORY_ID to use discount effects.');

      return actions;
    }

    const money = new Money(MoneyType.DECIMAL_PRECISION, this._currencyCode, effect.props.value);

    const builder = new AddCustomLineItemBuilder();
    const triggeredByCoupon = this._context.coupons[effect.triggeredByCoupon];
    let slugName = effect.props.name;

    if (triggeredByCoupon) {
      slugName = slugName.concat('-', triggeredByCoupon);
    }

    slugName += `-${this._slugIndex++}`;

    builder
      .name(this._lang, effect.props.name)
      .price(money.getCentAmount() * -1, money.getCurrencyCode())
      .slug(slugify(slugName))
      .taxCategory(this._taxCategoryId)
      .effectMetadata(EffectType.setDiscount, triggeredByCoupon);

    actions.push(builder.build());

    return actions;
  }

  /**
   * @param {any} effect
   * @param {any[]} actions
   * @return {any[]}
   * @private
   */
  _setDiscountPerItemEffect(effect, actions) {
    const builder = new SetLineItemTotalPriceBuilder();

    const position = effect.props.position;
    let cartItem = null;
    let lineItem = null;

    this._talonSession.cartItems.forEach((item) => {
      if (item.position === position) {
        cartItem = item;
      }
    });

    if (cartItem === null) {
      return actions;
    }

    this._cart.lineItems.forEach((item, i) => {
      if (
        cartItem.sku === item.productId &&
        item.custom?.fields?.[TalonOneLineItemMetadata.effectFieldName] !== EffectType.addFreeItem
      ) {
        if (i === cartItem.position) {
          lineItem = item;
        }
      }
    });

    if (lineItem === null) {
      return actions;
    }

    const {
      centAmount: baseCentAmount,
      currencyCode: baseCurrencyCode,
      fractionDigits: baseFractionDigits = 2,
    } = lineItem.price.value;

    const setLineItemTotalPriceAction = this._findSetLineItemTotalPriceActionById(
      lineItem.id,
      actions
    );

    const baseMoney = new Money(
      MoneyType.CENT_PRECISION,
      baseCurrencyCode,
      baseCentAmount,
      baseFractionDigits
    );

    const discountMoney = new Money(
      MoneyType.DECIMAL_PRECISION,
      this._currencyCode,
      effect.props.value
    );

    if (setLineItemTotalPriceAction?.externalTotalPrice?.totalPrice?.centAmount) {
      baseMoney.amount = setLineItemTotalPriceAction.externalTotalPrice.totalPrice.centAmount;

      setLineItemTotalPriceAction.externalTotalPrice.totalPrice.centAmount = baseMoney
        .subtract(discountMoney, MoneyType.DECIMAL_PRECISION)
        .getCentAmount();
    } else {
      const afterDiscountMoney = baseMoney
        .multiply(lineItem.quantity)
        .subtract(discountMoney, MoneyType.DECIMAL_PRECISION);

      builder
        .lineItemId(lineItem.id)
        .price(baseMoney.getCentAmount(), baseMoney.getCurrencyCode())
        .totalPrice(afterDiscountMoney.getCentAmount(), afterDiscountMoney.getCurrencyCode());

      actions.push(builder.build());
    }

    return actions;
  }

  _findSetLineItemTotalPriceActionById(lineItemId, actions = []) {
    let action = null;

    actions.forEach((item) => {
      if (item.action === UpdateAction.setLineItemTotalPrice && item.lineItemId === lineItemId) {
        action = item;
      }
    });

    return action;
  }

  /**
   * @param {any} effect
   * @param {any[]} actions
   * @return {any[]}
   * @private
   */
  _addFreeItemEffect(effect, actions) {
    const builder = new AddLineItemBuilder();

    builder.effectMetadata(EffectType.addFreeItem).price(0, this._currencyCode).quantity(1);

    switch (this._skuType) {
      case SkuType.CTP_PRODUCT_ID:
        builder.productId(effect.props.sku);
        break;

      case SkuType.CTP_PRODUCT_ID_WITH_VARIANT_ID:
        // eslint-disable-next-line no-case-declarations
        const [productId, variantId = 1] = effect.props.sku.split(this._skuSeparator, 2);
        builder.productId(productId).variantId(variantId);
        break;

      default:
        // SkuType.CTP_VARIANT_SKU
        builder.sku(effect.props.sku);
        break;
    }

    actions.push(builder.build());

    return actions;
  }

  /**
   * @param {any} effect
   * @param {any[]} actions
   * @return {any[]}
   * @private
   */
  _showNotificationEffect(effect, actions) {
    const { notificationType, title, body } = effect.props;

    this._customType.addNotification(
      new Notification(notificationType, title, body, EffectType.showNotification)
    );

    return actions;
  }

  /**
   * @param {any} effect
   * @param {any[]} actions
   * @return {any[]}
   * @private
   */
  _acceptCouponEffect(effect, actions) {
    if (!this._taxCategoryId) {
      this._logger.error('You must define DISCOUNT_TAX_CATEGORY_ID to use coupons.');

      return actions;
    }

    const { value } = effect.props;
    const money = new Money(MoneyType.DECIMAL_PRECISION, this._currencyCode, 0);

    const addCustomLineItemBuilder = new AddCustomLineItemBuilder();
    const triggeredByCoupon = this._context.coupons[effect.triggeredByCoupon];

    addCustomLineItemBuilder
      .name(this._lang, value)
      .price(money.getCentAmount(), money.getCurrencyCode())
      .slug(slugify(value))
      .taxCategory(this._taxCategoryId)
      .effectMetadata(EffectType.acceptCoupon, triggeredByCoupon);

    actions.push(addCustomLineItemBuilder.build());

    this._customType.addNotification(new InfoNotification('', value, EffectType.acceptCoupon));

    return actions;
  }

  /**
   * @param {any} effect
   * @param {any[]} actions
   * @return {any[]}
   * @private
   */
  _rejectCouponEffect(effect, actions) {
    const { value, rejectionReason } = effect.props;

    this._customType.addNotification(
      new ErrorNotification('', value, EffectType.rejectCoupon, rejectionReason)
    );

    return actions;
  }

  /**
   * @param {any} effect
   * @param {any[]} actions
   * @return {any[]}
   * @private
   */
  _acceptReferralEffect(effect, actions) {
    let { value } = effect.props;
    const referralCode = this._cart?.custom?.fields?.[TalonOneCartMetadata.referralCodesFieldName];

    if (referralCode) {
      this._customType.referralCode(referralCode);
    }

    if (referralCode.search(value) !== -1) {
      value = referralCode;
    }

    this._customType.addNotification(new InfoNotification('', value, EffectType.acceptReferral));

    return actions;
  }

  /**
   * @param {any} effect
   * @param {any[]} actions
   * @return {any[]}
   * @private
   */
  _rejectReferralEffect(effect, actions) {
    // eslint-disable-next-line prefer-const
    let { value, rejectionReason } = effect.props;
    const referralCode = this._cart?.custom?.fields?.[TalonOneCartMetadata.referralCodesFieldName];

    if (referralCode?.search(value) !== -1) {
      value = referralCode;
    }

    this._customType.removeReferralCode();
    this._customType.addNotification(
      new ErrorNotification('', value, EffectType.rejectReferral, rejectionReason)
    );

    return actions;
  }

  /**
   * @param {any[]} effects
   * @param {any[]} actions
   * @return {any[]}
   * @private
   */
  _prepareContext(effects, actions) {
    // id -> code
    const coupons = {};

    for (const effect of effects) {
      if (effect?.effectType === EffectType.acceptCoupon) {
        coupons[effect.triggeredByCoupon] = effect.props.value;
      }
    }

    this._context.coupons = coupons;

    return actions;
  }

  /**
   * @param {any[]} effects
   * @param {any[]} actions
   * @return {any[]}
   * @private
   */
  _buildCustomType(effects, actions) {
    const payWithPoints = this._cart?.custom?.fields?.[TalonOneCartMetadata.payWithPointsFieldName];

    if (payWithPoints) {
      this._customType.cartType().payWithPoints(payWithPoints);
    }

    return [this._customType.build(), ...actions];
  }

  /**
   * @returns {Object}
   * @private
   */
  _helpers() {
    let fetchId;
    let fetcher;

    switch (this._skuType) {
      case SkuType.CTP_PRODUCT_ID:
      case SkuType.CTP_PRODUCT_ID_WITH_VARIANT_ID:
        fetchId = (action) => action.productId;
        fetcher = (ids) => this._ctpApiClient().fetchProductsByProductIds(ids);
        break;

      default:
        // SkuType.CTP_VARIANT_SKU
        fetchId = (action) => action.sku;
        fetcher = (skus) => this._ctpApiClient().fetchProductsBySkus(skus);
        break;
    }

    return { fetchId, fetcher };
  }

  /**
   * @param {any[]} effects
   * @param {any[]} actions
   * @return {any[]}
   * @private
   */
  _prefetching(effects, actions) {
    if (this._cart?.customerId) {
      this._customerPrefetching = this._ctpApiClient().fetchCustomerById(this._cart.customerId);
    }

    return actions;
  }

  /**
   * @param {any[]} effects
   * @param {any[]} actions
   * @return {any[]}
   * @private
   */
  async _updateCustomer(effects, actions) {
    const customerId = this._cart?.customerId;
    this._logger.test('update customer id').test(customerId).test(this._sessionLoyalty, true);

    if (!customerId) {
      return actions;
    }

    if (!effects?.length) {
      effects = [];
    }

    const referralCodes = {};

    let loyaltyPrograms = this._sessionLoyalty?.programs || [];
    let loyaltyProgramsFromCustomer = [];

    for (const effect of effects) {
      if (effect?.effectType === EffectType.referralCreated) {
        const name = effect.ruleName;
        const code = `${effect.fromApi}${REFERRAL_CODE_SEPARATOR}${effect.props.value}`;

        if (referralCodes[name]) {
          referralCodes[name].codes.push(code);
        } else {
          referralCodes[name] = {
            codes: [code],
          };
        }
      }
    }

    if (
      (!Object.keys(loyaltyPrograms)?.length && !Object.keys(referralCodes)?.length) ||
      !this._customerPrefetching
    ) {
      return actions;
    }

    const customer = await this._customerPrefetching;
    const customFields = customer?.custom;

    this._logger.test('customer').test(customer, true);

    if (!customer?.version) {
      return actions;
    }

    const builder = new SetCustomTypeBuilder(customFields?.fields ?? {});
    builder.customerType();

    if (customFields?.fields?.[TalonOneCustomerMetadata.referralCodesFieldName]) {
      builder.referrals(customFields.fields[TalonOneCustomerMetadata.referralCodesFieldName]);
    }

    for (const referralCode of Object.values(referralCodes)) {
      builder.addReferral(referralCode.codes.join(REFERRAL_CODE_SEPARATOR));
    }

    if (loyaltyPrograms) {
      try {
        loyaltyPrograms = Object.values(loyaltyPrograms).map(
          ({ id, name, title, ledger }) =>
            new LoyaltyPoints(id, name, title, ledger?.currentBalance || 0, this._currencyCode)
        );
      } catch (e) {
        this._logger.error(e);
      }
    }

    if (customFields?.fields?.[TalonOneCustomerMetadata.loyaltyPointsFieldName]) {
      try {
        loyaltyProgramsFromCustomer = JSON.parse(
          customFields.fields[TalonOneCustomerMetadata.loyaltyPointsFieldName]
        ).map(
          ({ id, name, title, balance, currency }) =>
            new LoyaltyPoints(id, name, title, balance, currency)
        );
      } catch (e) {
        this._logger.error(e);
      }
    }

    if (
      JSON.stringify(loyaltyPrograms) !==
      JSON.stringify(
        loyaltyProgramsFromCustomer.filter((p) => p.getCurrency() === this._currencyCode)
      )
    ) {
      builder.loyaltyPoints([
        ...loyaltyProgramsFromCustomer.filter((p) => p.getCurrency() !== this._currencyCode),
        ...loyaltyPrograms,
      ]);
    } else if (builder.hasReferrals() && loyaltyProgramsFromCustomer?.length) {
      builder.loyaltyPoints(loyaltyProgramsFromCustomer);
    }

    if (builder.hasReferrals() || builder.hasLoyaltyPoints()) {
      const customerUpdateActions = [builder.build()];
      process.env.__CUSTOMER_UPDATE_ACTIONS = JSON.stringify(customerUpdateActions);

      this._logger.test('customerUpdateActions').test(customerUpdateActions, true);

      if (customerUpdateActions) {
        const result = await this._ctpApiClient().updateCustomerById(
          customerId,
          customer.version,
          customerUpdateActions
        );

        this._logger.test('updateCustomerById').test(result, true);
      }
    }

    return actions;
  }

  /**
   * @param {any[]} effects
   * @param {any[]} actions
   * @return {any[]}
   * @private
   */
  async _verifyFreeItems(effects, actions) {
    this._logger.test('verify free items');

    if (!this._verifyFreeItemsFlag) {
      return actions;
    }

    const freeItems = [];
    const { fetchId, fetcher } = this._helpers();

    // eslint-disable-next-line guard-for-in,no-restricted-syntax
    for (const pos in actions) {
      const action = actions[pos];
      const effect = action.custom?.fields?.[TalonOneLineItemMetadata.effectFieldName];

      if (effect === EffectType.addFreeItem) {
        freeItems.push({
          fetchId: fetchId(action),
          indexId: this._getIdFromAction(action),
          pos,
        });
      }
    }

    let data;
    const dataIndex = {};

    try {
      data = await fetcher(freeItems.map((v) => v.fetchId));
    } catch (err) {
      this._logger.error(err);
    }

    this._logger.test(data, true);

    if (Array.isArray(data?.body?.results)) {
      for (const product of data?.body?.results) {
        const masterVariant = product?.masterData?.current?.masterVariant;

        if (masterVariant) {
          dataIndex[this._prepareId(masterVariant.sku, product.id, masterVariant.id)] = product;
        }

        const variants = product?.masterData?.current?.variants;

        if (Array.isArray(variants)) {
          for (const { id, sku } of variants) {
            dataIndex[this._prepareId(sku, product.id, id)] = product;
          }
        }
      }
    }

    for (const freeItem of freeItems) {
      if (!dataIndex[freeItem.indexId]) {
        this._logger.info({
          invalidProductSku: freeItem,
        });
        delete actions[freeItem.pos];
      }
    }

    // reindex
    return actions.filter((val) => val);
  }

  /**
   * @param {any[]} effects
   * @param {any[]} actions
   * @return {any[]}
   * @private
   */
  async _verifyTaxIds(effects, actions) {
    this._logger.test('verify tax ids');

    if (!this._verifyTaxIdsFlag) {
      return actions;
    }

    let fetchData = false;

    // eslint-disable-next-line guard-for-in,no-restricted-syntax
    for (const pos in actions) {
      const { action } = actions[pos];

      if (action === UpdateAction.addCustomLineItem) {
        fetchData = true;

        break;
      }
    }

    if (!fetchData) {
      this._logger.info('Skipping tax category validation...');
      return actions;
    }

    let data = [];

    try {
      data = await this._ctpApiClient().fetchTaxCategoryByIds([this._taxCategoryId]);
    } catch (err) {
      this._logger.error(err);
    }

    this._logger.test(data, true);

    if (!data?.body?.total) {
      this._logger.error({
        invalidTaxCategoryId: this._taxCategoryId,
      });
      return [];
    }

    // reindex
    return actions;
  }

  /**
   * @param {any[]} effects
   * @param {any[]} actions
   * @return {any[]}
   * @private
   */
  _reset(effects, actions) {
    const result = [];

    // remove notifications
    if (!this._customType.hasNotifications()) {
      this._customType.notifications([]);
    }

    // remove custom lines
    for (const customLineItem of this._customLineItems) {
      const couponCode = customLineItem.custom.fields?.[TalonOneCartMetadata.couponCode];
      const couponCodeAction =
        customLineItem.custom.fields?.[TalonOneCartMetadata.couponCodeAction];

      if (couponCodeAction === TalonOneCartMetadata.applyCoupon && couponCode) {
        continue;
      }

      const builder = new RemoveCustomLineItemBuilder();
      result.push(builder.customLineItemId(customLineItem.id).build());
    }

    // remove free items
    for (const lineItem of this._lineItems) {
      const effect = lineItem.custom?.fields?.[TalonOneLineItemMetadata.effectFieldName];

      if (effect === EffectType.addFreeItem) {
        const builder = new ChangeLineItemQuantityBuilder();

        builder.lineItemId(lineItem.id);
        builder.quantity(0);

        result.push(builder.build());
      }

      // This is a bit sus, in the new "cart item discount" test I had to add an extra
      // action in the output to cater for this, which resets the price for an item. This
      // action is then immediately countered by a second action that sets the price
      // again. See mocks/actions/update-cart-with-per-item-discount-actions.json
      // If I remove this another test fails so I'm keeping it for now.
      if (lineItem.priceMode === 'ExternalTotal') {
        const builder = new SetLineItemTotalPriceBuilder();
        result.push(builder.lineItemId(lineItem.id).build());
      }
    }

    return [...result, ...actions];
  }

  /**
   * @param {string} sku
   * @param {string} productId
   * @param {number} variantId
   * @returns {string}
   * @private
   */
  _getIdFromAction({ sku, productId, variantId }) {
    return this._prepareId(sku, productId, variantId);
  }

  /**
   * @param {string} sku
   * @param {string} productId
   * @param {number} variantId
   * @returns {string}
   * @private
   */
  _prepareId(sku, productId, variantId) {
    switch (this._skuType) {
      case SkuType.CTP_PRODUCT_ID:
        return productId;

      case SkuType.CTP_PRODUCT_ID_WITH_VARIANT_ID:
        return `${productId}-${variantId}`;

      default:
        // SkuType.CTP_VARIANT_SKU
        return sku;
    }
  }

  /**
   * @param {any[]} effects
   * @param {any[]} actions
   * @return {any[]}
   * @private
   */
  _compactAddLineItemActions(effects, actions) {
    const result = [...actions];
    const index = {};

    const addToIndex = (id, pos) => {
      index[id] = {
        positions: index[id] ? [...index[id].positions, pos] : [pos],
        compact: Boolean(index[id]),
      };
    };

    // eslint-disable-next-line guard-for-in,no-restricted-syntax
    for (const pos in actions) {
      const action = actions[pos];

      if (action.action === UpdateAction.addLineItem) {
        addToIndex(this._getIdFromAction(action), pos);
      }
    }

    // compact the same actions
    for (const i of Object.keys(index)) {
      const { compact, positions } = index[i];

      if (compact) {
        let last = null;
        let quantity = 0;

        for (const pos of positions) {
          last = result[pos];
          quantity += last?.quantity ?? 1;
          delete result[pos];
        }

        result.push({
          ...last,
          quantity,
        });
      }
    }

    // reindex
    return result.filter((val) => val);
  }

  /**
   * @param {any[]} effects
   * @param {any[]} actions
   * @return {any[]}
   * @private
   */
  _compactSetLineItemTotalPriceActions(effects, actions) {
    const result = [...actions];

    // [id, position]
    const withoutPrices = [];

    // id -> position
    const withPrices = {};

    // eslint-disable-next-line guard-for-in,no-restricted-syntax
    for (const pos in actions) {
      const action = actions[pos];

      if (action.action === UpdateAction.setLineItemTotalPrice) {
        if (!action.externalTotalPrice) {
          withoutPrices.push([action.lineItemId, pos]);
        } else {
          withPrices[action.lineItemId] = pos;
        }
      }
    }

    for (const [id, pos] of withoutPrices) {
      if (withPrices[id]) {
        delete result[pos];
      }
    }

    // reindex
    return actions.filter((val) => val);
  }
}

module.exports = {
  CartActionFactory,
  PREFETCHING_PIPE,
  PREPARE_CONTEXT_PIPE,
  EFFECTS_PIPE,
  COMPACT_ADD_LINE_ITEM_ACTIONS_PIPE,
  COMPACT_SET_LINE_ITEM_TOTAL_PRICE_PIPE,
  RESET_PIPE,
  VERIFY_FREE_ITEMS_PIPE,
  VERIFY_TAX_IDS_PIPE,
  BUILD_CUSTOM_TYPE_PIPE,
  UPDATE_CUSTOMER_PIPE,
};
