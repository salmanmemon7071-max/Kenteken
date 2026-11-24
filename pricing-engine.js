(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.VehiclePricing = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const PRIMARY_IDS = new Set(['basic', 'gold', 'platinum', 'diamond', 'ruby', 'sapphire']);
  const STICKER_ID = 'window-sticker';
  const toCents = value => {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) throw new Error('Invalid package price.');
    return Math.round(number * 100);
  };
  const money = cents => (cents / 100).toFixed(2);
  function calculate({ packages, packageId, windowStickerSelected, pricingRules = {}, currency = 'USD' }) {
    if (!Array.isArray(packages)) throw new Error('Packages are unavailable.');
    const primary = packages.find(item => item.id === packageId);
    if (!primary) throw new Error('Please select an available package.');
    const isPrimary = PRIMARY_IDS.has(primary.id);
    const sticker = packages.find(item => item.id === STICKER_ID);
    const includeSticker = isPrimary && Boolean(windowStickerSelected);
    if (includeSticker && !sticker) throw new Error('Window Sticker is currently unavailable.');

    const primaryCents = toCents(primary.price);
    const stickerCents = includeSticker ? toCents(sticker.price) : 0;
    let stickerDiscountCents = 0;
    let discountLabel = '';
    if (includeSticker) {
      const fixedRates = { basic: 2500, gold: 5000, platinum: 10000, diamond: 10000 };
      const configured = pricingRules.windowStickerDiscountPercentByPackage?.[primary.id];
      const rateBps = Object.prototype.hasOwnProperty.call(fixedRates, primary.id) ? fixedRates[primary.id] :
        Math.round(Math.max(0, Math.min(100, Number(configured) || 0)) * 100);
      stickerDiscountCents = Math.round(stickerCents * rateBps / 10000);
      if (stickerDiscountCents) discountLabel = rateBps === 10000 ? 'Window Sticker included' : `Window Sticker ${rateBps / 100}% discount`;
    }
    const certificateIncluded = primary.id === 'diamond' && includeSticker;
    const discountCents = stickerDiscountCents;
    const totalCents = primaryCents + stickerCents - discountCents;
    return {
      currency: String(currency || 'USD').toUpperCase(), packageId: primary.id, packageName: primary.name,
      primaryCents, stickerSelected: includeSticker,
      stickerCents, stickerDiscountCents, discountCents, discountLabel,
      certificateIncluded, totalCents,
      lineItems: [
        { id: primary.id, name: primary.name, type: 'primary', amountCents: primaryCents },
        ...(includeSticker ? [{ id: sticker.id, name: sticker.name, type: 'addon', amountCents: stickerCents }] : []),
        ...(certificateIncluded ? [{ id: 'verified-seller-certificate', name: 'Verified Seller Certificate', type: 'included', amountCents: 0 }] : [])
      ],
      subtotalCents: primaryCents + stickerCents,
      primaryAmount: money(primaryCents), stickerAmount: money(stickerCents),
      discountAmount: money(discountCents), totalAmount: money(totalCents)
    };
  }
  return { PRIMARY_IDS: [...PRIMARY_IDS], STICKER_ID, toCents, money, calculate };
});
