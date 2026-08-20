/**
 * Regional Pricing for Odoo Integration for Gmail
 *
 * Uses ParityDeals API to detect visitor's location and display
 * appropriate pricing that matches the checkout price.
 *
 * Prices are defined in PLANS (single source of truth).
 * HTML elements use data-plan/data-price/data-price-format attributes.
 */

(function() {
    'use strict';

    // ===========================================
    // CONFIGURATION — Single source of truth
    // ===========================================

    const PLANS = {
        plus: {
            monthlyPrice: 19,
            annualDiscount: 0.8 // 20% off for annual
        },
        team: {
            pricePerUser: 19,
            annualDiscount: 0.8
        }
    };

    const CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour
    const PD_IDENTIFIER = 'ac2b5915-53b6-4f30-a157-847f446ae825';
    const PARITY_DEALS_API = 'https://api.paritydeals.com/api/v1/deals/discount/?pd_identifier=' + PD_IDENTIFIER;

    // ===========================================
    // PARITY DEALS API
    // ===========================================

    /**
     * Fetch discount information from ParityDeals API
     * @returns {Promise<Object|null>} Discount data or null on error
     */
    async function fetchParityDealsDiscount() {
        try {
            const response = await fetch(PARITY_DEALS_API, {
                method: 'GET',
                headers: { 'Accept': 'application/json' }
            });

            if (!response.ok) {
                console.warn('[RegionalPricing] ParityDeals API returned:', response.status);
                return null;
            }

            return await response.json();
        } catch (error) {
            console.warn('[RegionalPricing] Failed to fetch from ParityDeals:', error.message);
            return null;
        }
    }

    // ===========================================
    // PRICE CALCULATION
    // ===========================================

    /**
     * Split a raw price into integer and cents parts
     * @param {number} raw - Raw price value
     * @returns {{ integer: number, cents: string }}
     */
    function splitPrice(raw) {
        const integer = Math.floor(raw);
        const cents = Math.round((raw - integer) * 100).toString().padStart(2, '0');
        return { integer, cents };
    }

    /**
     * Calculate prices for the PLUS plan
     * @param {number} discountPercent - Regional discount percentage
     * @returns {Object} Price data keyed by data-price attribute values
     */
    function calculatePlusPrices(discountPercent) {
        const multiplier = 1 - (discountPercent / 100);
        const monthlyRaw = PLANS.plus.monthlyPrice * multiplier;
        const annualRaw = monthlyRaw * 12 * PLANS.plus.annualDiscount;

        return {
            monthly: splitPrice(monthlyRaw),
            annual: splitPrice(annualRaw)
        };
    }

    /**
     * Calculate prices for the Team plan
     * @param {number} discountPercent - Regional discount percentage
     * @returns {Object} Price data keyed by data-price attribute values
     */
    function calculateTeamPrices(discountPercent) {
        const multiplier = 1 - (discountPercent / 100);
        return {
            perUser: splitPrice(PLANS.team.pricePerUser * multiplier)
        };
    }

    /**
     * List prices — what the visitor would pay with no discount at all.
     *
     * The annual anchor is 12 months at the monthly list price, NOT the annual
     * price: that one already has the 20% annual discount baked in, so using it
     * would make the annual plan look like it discounts less than the monthly one.
     *
     * @returns {Object} Anchor prices keyed by data-anchor attribute values
     */
    function calculateListPrices() {
        return {
            plus: {
                monthly: splitPrice(PLANS.plus.monthlyPrice),
                annualList: splitPrice(PLANS.plus.monthlyPrice * 12)
            },
            team: {
                perUser: splitPrice(PLANS.team.pricePerUser)
            }
        };
    }

    /**
     * Savings percentages for the badges.
     *
     * Monthly is the regional discount as-is. Annual compounds it with the annual
     * discount, measured against 12 months at the list price:
     *   1 - (1 - regional) * annualDiscount
     * With no regional discount that is the plain 20%; with 40% regional it is 52%.
     *
     * @param {number} discountPercent - Regional discount percentage
     * @returns {{ monthly: number, annual: number }} Rounded percentages
     */
    function calculateSavings(discountPercent) {
        const regional = discountPercent / 100;
        return {
            monthly: Math.round(discountPercent),
            annual: Math.round((1 - (1 - regional) * PLANS.plus.annualDiscount) * 100)
        };
    }

    // ===========================================
    // PRICE FORMATTING
    // ===========================================

    /**
     * Format price with cents in superscript (for large price displays)
     * @param {number} integer - Integer part
     * @param {string} cents - Cents part (2 digits)
     * @returns {string} HTML string
     */
    function formatPriceWithCents(integer, cents) {
        if (cents === '00') {
            return integer.toString();
        }
        return integer + '<span class="cents">' + cents + '</span>';
    }

    /**
     * Format price as plain number (no $ symbol — $ is in HTML)
     * @param {number} integer - Integer part
     * @param {string} cents - Cents part (2 digits)
     * @returns {string} Plain text like "182" or "109.20"
     */
    function formatPriceText(integer, cents) {
        if (cents === '00') {
            return integer.toString();
        }
        return integer + '.' + cents;
    }

    // ===========================================
    // DOM UPDATE — Generic by data attributes
    // ===========================================

    /**
     * Update all DOM elements for a given plan using data attributes.
     *
     * Elements must have:
     *   data-plan="planId"         — which plan (e.g. "plus", "team")
     *   data-price="priceKey"      — which price (e.g. "monthly", "annual")
     *   data-price-format="large"  — formatPriceWithCents (HTML, for .price-large .amount)
     *   data-price-format="text"   — formatPriceText (plain number, default)
     *
     * @param {string} planId - Plan identifier matching data-plan attribute
     * @param {Object} prices - Object keyed by data-price values, each { integer, cents }
     */
    function updatePlanPrices(planId, prices) {
        document.querySelectorAll('[data-plan="' + planId + '"]').forEach(function(el) {
            var priceKey = el.getAttribute('data-price');
            var format = el.getAttribute('data-price-format') || 'text';
            var priceData = prices[priceKey];
            if (!priceData) return;

            if (format === 'large') {
                el.innerHTML = formatPriceWithCents(priceData.integer, priceData.cents);
            } else {
                el.textContent = formatPriceText(priceData.integer, priceData.cents);
            }
        });
    }

    // ===========================================
    // PRICE ANCHORS & SAVE BADGES
    // ===========================================

    /**
     * Reveal the struck-through list price next to each effective price.
     *
     * Elements must have data-plan + data-anchor, and start out `hidden`.
     * The monthly / per-user anchor only makes sense when there is a regional
     * discount; the annual one always does (there is always the annual discount).
     *
     * @param {string} planId - Plan identifier matching data-plan attribute
     * @param {Object} anchors - Object keyed by data-anchor values, each { integer, cents }
     * @param {boolean} showRegional - Whether a regional discount applies
     */
    function updateAnchors(planId, anchors, showRegional) {
        document.querySelectorAll('[data-plan="' + planId + '"][data-anchor]').forEach(function(el) {
            var key = el.getAttribute('data-anchor');
            var priceData = anchors[key];
            if (!priceData) return;
            if (key !== 'annualList' && !showRegional) return;

            el.textContent = formatPriceText(priceData.integer, priceData.cents);
            el.removeAttribute('hidden');
        });
    }

    /**
     * Fill in the `{pct}` placeholder left by static-i18n and reveal the badge.
     *
     * Each dynamic badge replaces a static one (`[data-save-fallback]`) that says
     * "Save 20%", so the card still reads correctly if this script never runs.
     *
     * @param {{ monthly: number, annual: number }} savings - Percentages to display
     * @param {boolean} showRegional - Whether a regional discount applies
     */
    function updateSaveBadges(savings, showRegional) {
        document.querySelectorAll('[data-save]').forEach(function(el) {
            var key = el.getAttribute('data-save');
            var pct = key === 'annual' ? savings.annual : savings.monthly;
            if (key !== 'annual' && !showRegional) return;
            if (typeof pct !== 'number' || isNaN(pct)) return;

            el.textContent = el.textContent.replace('{pct}', pct);
            el.removeAttribute('hidden');

            var fallback = el.parentNode && el.parentNode.querySelector('[data-save-fallback]');
            if (fallback) fallback.setAttribute('hidden', '');
        });
    }

    // ===========================================
    // SCHEMA.ORG UPDATE
    // ===========================================

    /**
     * Update Schema.org structured data with calculated prices
     * @param {Object} allPrices - Object keyed by plan name, each containing price data
     */
    function updateSchemaOrg(allPrices) {
        var schemaScripts = document.querySelectorAll('script[type="application/ld+json"]');
        schemaScripts.forEach(function(script) {
            try {
                var schema = JSON.parse(script.textContent);

                // Handle @graph wrapper
                var offers = null;
                if (schema['@graph']) {
                    for (var i = 0; i < schema['@graph'].length; i++) {
                        if (schema['@graph'][i].offers) {
                            offers = schema['@graph'][i].offers;
                            break;
                        }
                    }
                } else if (schema.offers) {
                    offers = schema.offers;
                }

                if (!offers || !Array.isArray(offers)) return;

                var modified = false;
                offers.forEach(function(offer) {
                    if (!offer.name) return;

                    // Match PLUS offers
                    if (allPrices.plus) {
                        if (offer.name === 'PLUS Monthly') {
                            offer.price = formatPriceText(allPrices.plus.monthly.integer, allPrices.plus.monthly.cents);
                            modified = true;
                        } else if (offer.name === 'PLUS Yearly') {
                            offer.price = formatPriceText(allPrices.plus.annual.integer, allPrices.plus.annual.cents);
                            modified = true;
                        }
                    }

                    // Match Team offers
                    if (allPrices.team && offer.name === 'Team Monthly') {
                        offer.price = formatPriceText(allPrices.team.perUser.integer, allPrices.team.perUser.cents);
                        modified = true;
                    }
                });

                if (modified) {
                    script.textContent = JSON.stringify(schema);
                }
            } catch (e) {
                // Ignore JSON parse errors
            }
        });
    }

    // ===========================================
    // ANALYTICS
    // ===========================================

    /**
     * Report the resolved pricing context to GA4.
     *
     * The anchor only shows up where there is a regional discount, so without the
     * country breakdown there is no way to tell whether it moves the needle.
     * Fired on every path, including when ParityDeals could not be reached.
     *
     * @param {Object|null} data - ParityDeals response, or null if unavailable
     * @param {number} discountPercent - Discount actually applied
     */
    function trackPricingView(data, discountPercent) {
        if (typeof gtag !== 'function') return;

        gtag('event', 'pricing_viewed', {
            country: (data && data.country) || 'unknown',
            country_code: (data && data.countryCode) || 'unknown',
            discount_percentage: discountPercent,
            is_vpn: !!(data && (data.isVpn || data.isProxy || data.isTor)),
            pd_resolved: !!data
        });
    }

    // ===========================================
    // CACHING
    // ===========================================

    /**
     * Store discount data in sessionStorage
     * @param {Object} data - ParityDeals response data
     */
    function cacheDiscountData(data) {
        try {
            sessionStorage.setItem('parity_deals_discount', JSON.stringify(data));
            sessionStorage.setItem('parity_deals_timestamp', Date.now().toString());
        } catch (e) {
            // sessionStorage not available
        }
    }

    /**
     * Get cached discount data if still valid
     * @returns {Object|null} Cached data or null
     */
    function getCachedDiscountData() {
        try {
            var data = sessionStorage.getItem('parity_deals_discount');
            var timestamp = sessionStorage.getItem('parity_deals_timestamp');

            if (data && timestamp) {
                var age = Date.now() - parseInt(timestamp, 10);
                if (age < CACHE_DURATION_MS) {
                    return JSON.parse(data);
                }
            }
        } catch (e) {
            // sessionStorage not available or parse error
        }
        return null;
    }

    // ===========================================
    // PRICE VISIBILITY CONTROL
    // ===========================================

    const PRICE_SELECTORS = '[data-plan][data-price], [data-plan][data-anchor]';

    /**
     * Hide price elements initially to prevent flash
     * Note: CSS is already in HTML <head>, this is just a fallback
     */
    function hidePrices() {
        if (document.getElementById('regional-pricing-hide')) return;
        var style = document.createElement('style');
        style.id = 'regional-pricing-hide';
        style.textContent = PRICE_SELECTORS + ' { opacity: 0; }';
        document.head.appendChild(style);
    }

    /**
     * Show price elements with fade-in
     */
    function showPrices() {
        var style = document.getElementById('regional-pricing-hide');
        if (style) {
            style.textContent = PRICE_SELECTORS + ' { opacity: 1; transition: opacity 0.2s ease-in; }';
        }
    }

    // ===========================================
    // MAIN INITIALIZATION
    // ===========================================

    async function init() {
        // Only run on pages with pricing content
        var hasPricingContent = document.querySelector('[data-plan]');
        if (!hasPricingContent) {
            return;
        }

        // Hide prices immediately to prevent flash
        hidePrices();

        // Check cache first
        var data = getCachedDiscountData();

        if (!data) {
            data = await fetchParityDealsDiscount();
            if (data) {
                cacheDiscountData(data);
            }
        }

        if (!data) {
            console.log('[RegionalPricing] No discount data available, using default prices');
            trackPricingView(null, 0);
            showPrices();
            return;
        }

        // Log API response for debugging
        console.log('[RegionalPricing] API response:', {
            country: data.country,
            countryCode: data.countryCode,
            discountPercentage: data.discountPercentage,
            isVpn: data.isVpn,
            isProxy: data.isProxy,
            isTor: data.isTor
        });

        // Determine discount percentage
        var discountPercent = 0;

        // Check for VPN/proxy - use base price if detected
        if (data.isVpn || data.isProxy || data.isTor) {
            console.log('[RegionalPricing] VPN/Proxy detected, using default prices');
        } else {
            discountPercent = parseFloat(data.discountPercentage || 0);

            // A non-numeric or out-of-range value would propagate NaN all the way
            // into the card ($NaNNaN/month), so fall back to list prices instead.
            if (!isFinite(discountPercent) || discountPercent < 0 || discountPercent >= 100) {
                console.warn('[RegionalPricing] Invalid discount, using default prices:', data.discountPercentage);
                discountPercent = 0;
            }

            if (discountPercent === 0) {
                console.log('[RegionalPricing] No discount for', data.country || 'this region');
            } else {
                console.log('[RegionalPricing] Applying', discountPercent + '% discount for', data.country);
            }
        }

        trackPricingView(data, discountPercent);

        // Prices start at opacity 0 and only showPrices() reveals them, so any
        // failure below must not leave the card blank — hence the finally.
        try {
            // Calculate and update all plan prices
            var allPrices = {};

            var plusPrices = calculatePlusPrices(discountPercent);
            allPrices.plus = plusPrices;
            updatePlanPrices('plus', plusPrices);

            var teamPrices = calculateTeamPrices(discountPercent);
            allPrices.team = teamPrices;
            updatePlanPrices('team', teamPrices);

            // Reveal the list price alongside it, and the matching save badges
            var listPrices = calculateListPrices();
            var savings = calculateSavings(discountPercent);
            var showRegional = discountPercent > 0;

            updateAnchors('plus', listPrices.plus, showRegional);
            updateAnchors('team', listPrices.team, showRegional);
            updateSaveBadges(savings, showRegional);

            // Update Schema.org structured data
            updateSchemaOrg(allPrices);
        } finally {
            showPrices();
        }
    }

    // Run when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
