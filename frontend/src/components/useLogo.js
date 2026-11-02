/**
 * ProofPass - Company Logo Resolver (useLogo.js)
 * WP8: Replaces deprecated Clearbit API with deterministic local vector assets
 * and high-resolution web fallback.
 */

const LOCAL_LOGO_MAP = {
  'persistent.com': '/logos/persistent.svg',
  'infosys.com': '/logos/infosys.svg',
  'barclays.com': '/logos/barclays.svg',
  'mastercard.com': '/logos/mastercard.svg',
  'cognizant.com': '/logos/cognizant.svg',
  'druva.com': '/logos/druva.svg',
  'icertis.com': '/logos/icertis.svg',
  'rebelfoods.com': '/logos/rebelfoods.svg',
  'firstcry.com': '/logos/firstcry.svg',
  'razorpay.com': '/logos/razorpay.svg',
  'postman.com': '/logos/postman.svg',
  'zomato.com': '/logos/zomato.svg'
}

export function getCompanyLogo(domain) {
  if (!domain) return null
  const cleanDomain = domain.toLowerCase().trim()
  if (LOCAL_LOGO_MAP[cleanDomain]) {
    return LOCAL_LOGO_MAP[cleanDomain]
  }
  // High-res Google Favicon CDN fallback (128px)
  return `https://www.google.com/s2/favicons?domain=${cleanDomain}&sz=128`
}

