export interface WeaponSemanticTerm {
  id: string
  canonical: string
  searchTerms: string
  patterns: RegExp[]
  variants?: WeaponVariantSemantic[]
}

export interface WeaponVariantSemantic {
  id: string
  label: string
  canonical: string
  searchTerms: string
  /** Patterns that mean the user explicitly selected this branch. */
  patterns: RegExp[]
  /** Strong evidence that a manual page belongs to this branch. */
  evidencePatterns: RegExp[]
}

export interface WeaponVariantResolution {
  family: WeaponSemanticTerm
  explicitVariants: WeaponVariantSemantic[]
  ambiguousVariants: WeaponVariantSemantic[]
}

/**
 * Deterministic DCS weapon vocabulary used before either local retrieval or
 * native web search.  Chinese community names are aliases only: the canonical
 * designation remains the exact store family/model used by the manuals.
 */
export const DCS_WEAPON_ONTOLOGY: WeaponSemanticTerm[] = [
  {
    id: 'aim-54', canonical: 'AIM-54 Phoenix（不死鸟）', searchTerms: 'AIM-54 AIM54 Phoenix missile F-14 AWG-9 TWS PD-STT active radar missile employment', patterns: [/(?:不死鸟|凤凰导弹|菲尼克斯|AIM[\s-]*54|Phoenix)/i],
    variants: [
      { id: 'aim-54a-mk47', label: 'AIM-54A Mk 47', canonical: 'AIM-54A Mk 47', searchTerms: 'AIM-54A Mk 47 Phoenix motor guidance employment', patterns: [/AIM[\s-]*54A.{0,12}Mk[.\s-]*47|54A[\s/-]*47/i], evidencePatterns: [/AIM[\s-]*54A.{0,24}Mk[.\s-]*47|Mk[.\s-]*47.{0,24}AIM[\s-]*54A/i] },
      { id: 'aim-54a-mk60', label: 'AIM-54A Mk 60', canonical: 'AIM-54A Mk 60', searchTerms: 'AIM-54A Mk 60 Phoenix motor guidance employment', patterns: [/AIM[\s-]*54A.{0,12}Mk[.\s-]*60|54A[\s/-]*60/i], evidencePatterns: [/AIM[\s-]*54A.{0,24}Mk[.\s-]*60|Mk[.\s-]*60.{0,24}AIM[\s-]*54A/i] },
      { id: 'aim-54c-mk47', label: 'AIM-54C Mk 47', canonical: 'AIM-54C Mk 47', searchTerms: 'AIM-54C Mk 47 Phoenix digital guidance employment', patterns: [/AIM[\s-]*54C.{0,12}Mk[.\s-]*47|54C[\s/-]*47/i], evidencePatterns: [/AIM[\s-]*54C.{0,24}Mk[.\s-]*47|Mk[.\s-]*47.{0,24}AIM[\s-]*54C/i] },
      { id: 'aim-54c-mk60', label: 'AIM-54C Mk 60', canonical: 'AIM-54C Mk 60', searchTerms: 'AIM-54C Mk 60 Phoenix digital guidance employment', patterns: [/AIM[\s-]*54C.{0,12}Mk[.\s-]*60|54C[\s/-]*60/i], evidencePatterns: [/AIM[\s-]*54C.{0,24}Mk[.\s-]*60|Mk[.\s-]*60.{0,24}AIM[\s-]*54C/i] },
    ],
  },
  { id: 'aim-7', canonical: 'AIM-7 Sparrow（麻雀）', searchTerms: 'AIM-7 AIM7 Sparrow semi active radar missile employment CW illumination', patterns: [/(?:麻雀导弹|麻雀弹|AIM[\s-]*7|Sparrow)/i] },
  {
    id: 'aim-9', canonical: 'AIM-9 Sidewinder（响尾蛇）', searchTerms: 'AIM-9 AIM9 Sidewinder infrared heat seeking missile seeker uncage tone', patterns: [/(?:响尾蛇|红外格斗弹|AIM[\s-]*9[A-Z]?|Sidewinder)/i],
    variants: [
      { id: 'aim-9p', label: 'AIM-9P', canonical: 'AIM-9P', searchTerms: 'AIM-9P rear aspect infrared Sidewinder employment', patterns: [/AIM[\s-]*9P\b|9P型?响尾蛇/i], evidencePatterns: [/AIM[\s-]*9P\b/i] },
      { id: 'aim-9m', label: 'AIM-9M', canonical: 'AIM-9M', searchTerms: 'AIM-9M all aspect infrared Sidewinder employment', patterns: [/AIM[\s-]*9M\b|9M型?响尾蛇/i], evidencePatterns: [/AIM[\s-]*9M\b/i] },
      { id: 'aim-9x', label: 'AIM-9X（JHMCS 高离轴）', canonical: 'AIM-9X', searchTerms: 'AIM-9X JHMCS high off boresight Sidewinder employment', patterns: [/AIM[\s-]*9X\b|9X型?响尾蛇/i], evidencePatterns: [/AIM[\s-]*9X\b|high[\s-]*off[\s-]*boresight/i] },
    ],
  },
  { id: 'aim-120', canonical: 'AIM-120 AMRAAM（阿姆拉姆）', searchTerms: 'AIM-120 AIM120 AMRAAM active radar missile employment launch pitbull maddog', patterns: [/(?:阿姆拉姆|主动雷达弹|一二零导弹|120导弹|AIM[\s-]*120|AMRAAM|maddog)/i] },
  {
    id: 'r-27', canonical: 'R-27 Alamo', searchTerms: 'R-27 R27 R-27R R-27ER R-27T R-27ET Alamo radar infrared missile employment', patterns: [/(?:R[\s-]*27(?:ER|ET|R|T)?|AA[\s-]*10|Alamo)/i],
    variants: [
      { id: 'r-27-radar', label: 'R-27R / R-27ER（半主动雷达）', canonical: 'R-27R/R-27ER', searchTerms: 'R-27R R-27ER semi active radar guidance illumination employment', patterns: [/R[\s-]*27(?:ER|R)\b|雷达型R[\s-]*27/i], evidencePatterns: [/R[\s-]*27(?:ER|R)\b|semi[\s-]*active radar/i] },
      { id: 'r-27-ir', label: 'R-27T / R-27ET（红外）', canonical: 'R-27T/R-27ET', searchTerms: 'R-27T R-27ET infrared seeker EOS lock before launch employment', patterns: [/R[\s-]*27(?:ET|T)\b|红外型R[\s-]*27/i], evidencePatterns: [/R[\s-]*27(?:ET|T)\b|infrared.{0,24}R[\s-]*27/i] },
    ],
  },
  { id: 'r-73', canonical: 'R-73 Archer', searchTerms: 'R-73 R73 Archer AA-11 infrared dogfight missile helmet sight', patterns: [/(?:R[\s-]*73|AA[\s-]*11|Archer)/i] },
  { id: 'r-77', canonical: 'R-77 Adder', searchTerms: 'R-77 R77 Adder AA-12 active radar missile employment', patterns: [/(?:R[\s-]*77|AA[\s-]*12|Adder)/i] },
  {
    id: 'agm-65', canonical: 'AGM-65 Maverick（小牛）', searchTerms: 'AGM-65 AGM65 Maverick TV IR CCD laser guided missile seeker boresight handoff lock track', patterns: [/(?:小牛(?:导弹)?|AGM[\s-]*65[A-Z0-9-]*|Maverick)/i],
    variants: [
      { id: 'agm-65-tv', label: 'AGM-65A/B（电视制导）', canonical: 'AGM-65A/AGM-65B TV Maverick', searchTerms: 'AGM-65A AGM-65B TV electro optical Maverick employment', patterns: [/AGM[\s-]*65[AB]\b|电视(?:型|制导)?小牛|TV小牛/i], evidencePatterns: [/AGM[\s-]*65[AB]\b/i] },
      { id: 'agm-65-ir', label: 'AGM-65D/G（红外成像）', canonical: 'AGM-65D/AGM-65G IR Maverick', searchTerms: 'AGM-65D AGM-65G imaging infrared IRMV IRMAV Maverick employment', patterns: [/AGM[\s-]*65[DG]\b|红外(?:型|制导)?小牛|IR小牛|IRMA?V/i], evidencePatterns: [/AGM[\s-]*65[DG]\b|\bIRMA?V\b/i] },
      { id: 'agm-65-ccd', label: 'AGM-65H/K（CCD/电视成像）', canonical: 'AGM-65H/AGM-65K CCD Maverick', searchTerms: 'AGM-65H AGM-65K CCD electro optical TV Maverick employment', patterns: [/AGM[\s-]*65[HK]\b|CCD(?:型|制导)?小牛/i], evidencePatterns: [/AGM[\s-]*65[HK]\b/i] },
      { id: 'agm-65-laser', label: 'AGM-65E/E2/L（激光制导）', canonical: 'AGM-65E/AGM-65E2/AGM-65L Laser Maverick', searchTerms: 'AGM-65E AGM-65E2 AGM-65L laser Maverick LMAV laser code employment', patterns: [/AGM[\s-]*65(?:E2?|L)\b|激光(?:型|制导)?小牛|LMAV/i], evidencePatterns: [/AGM[\s-]*65(?:E2?|L)\b|\bLMAV\b/i] },
    ],
  },
  { id: 'agm-88', canonical: 'AGM-88 HARM（哈姆）', searchTerms: 'AGM-88 AGM88 HARM high speed anti radiation missile HTS HAD HAS TOO POS PB SEAD', patterns: [/(?:哈姆|反辐射导弹|反雷达导弹|AGM[\s-]*88|HARM)/i] },
  {
    id: 'agm-84', canonical: 'AGM-84 Harpoon / SLAM（鱼叉家族）', searchTerms: 'AGM-84 AGM84 Harpoon SLAM SLAM-ER anti ship standoff land attack missile', patterns: [/(?:鱼叉|AGM[\s-]*84(?:D|E|H|K)?|Harpoon|SLAM(?:-ER)?)/i],
    variants: [
      { id: 'agm-84d', label: 'AGM-84D Harpoon（反舰）', canonical: 'AGM-84D Harpoon', searchTerms: 'AGM-84D Harpoon radar anti ship missile employment', patterns: [/AGM[\s-]*84D\b|反舰鱼叉|鱼叉(?!.*SLAM)|\bHarpoon\b(?!.*SLAM)/i], evidencePatterns: [/AGM[\s-]*84D\b|Harpoon.{0,32}(?:anti[\s-]*ship|radar)/i] },
      { id: 'agm-84e', label: 'AGM-84E SLAM（对陆/人在回路）', canonical: 'AGM-84E SLAM', searchTerms: 'AGM-84E SLAM land attack datalink pod man in the loop employment', patterns: [/AGM[\s-]*84E\b|\bSLAM\b(?![\s-]*ER)/i], evidencePatterns: [/AGM[\s-]*84E\b|\bSLAM\b(?![\s-]*ER)/i] },
      { id: 'agm-84hk', label: 'AGM-84H/K SLAM-ER（增程对陆）', canonical: 'AGM-84H/AGM-84K SLAM-ER', searchTerms: 'AGM-84H AGM-84K SLAM-ER land attack datalink terminal guidance employment', patterns: [/AGM[\s-]*84[HK]\b|SLAM[\s-]*ER/i], evidencePatterns: [/AGM[\s-]*84[HK]\b|SLAM[\s-]*ER/i] },
    ],
  },
  { id: 'agm-45', canonical: 'AGM-45 Shrike（百舌鸟）', searchTerms: 'AGM-45 AGM45 Shrike anti radiation missile', patterns: [/(?:百舌鸟|AGM[\s-]*45|Shrike)/i] },
  { id: 'agm-62', canonical: 'AGM-62 Walleye', searchTerms: 'AGM-62 AGM62 Walleye television guided glide bomb data link', patterns: [/(?:AGM[\s-]*62|Walleye|白星眼)/i] },
  {
    id: 'agm-114', canonical: 'AGM-114 Hellfire（地狱火）', searchTerms: 'AGM-114 AGM114 Hellfire laser radar guided missile SAL RF LOAL LOBL', patterns: [/(?:地狱火|AGM[\s-]*114|Hellfire)/i],
    variants: [
      { id: 'agm-114k', label: 'AGM-114K（SAL 激光制导）', canonical: 'AGM-114K SAL Hellfire', searchTerms: 'AGM-114K SAL semi active laser Hellfire laser code LOBL LOAL employment', patterns: [/AGM[\s-]*114K\b|K型?地狱火|激光(?:型|制导)?地狱火|\bSAL\b/i], evidencePatterns: [/AGM[\s-]*114K\b|Missile\s+Type\s+(?:is\s+)?SAL|\bSAL(?:1|2)?\s+(?:missile|Hellfire)/i] },
      { id: 'agm-114l', label: 'AGM-114L（RF 主动雷达制导）', canonical: 'AGM-114L RF Longbow Hellfire', searchTerms: 'AGM-114L RF Longbow Hellfire active radar FCR target data LOBL LOAL employment', patterns: [/AGM[\s-]*114L\b|L型?地狱火|雷达(?:型|制导)?地狱火|长弓地狱火|Longbow Hellfire|\bRF\b/i], evidencePatterns: [/AGM[\s-]*114L\b|Missile\s+Type\s+(?:is\s+)?RF|Radio\s+Frequency\s*\(RF\)\s+(?:missile|Hellfire)/i] },
    ],
  },
  { id: 'agm-122', canonical: 'AGM-122 Sidearm', searchTerms: 'AGM-122 AGM122 Sidearm anti radiation missile', patterns: [/(?:AGM[\s-]*122|Sidearm)/i] },
  {
    id: 'agm-154', canonical: 'AGM-154 JSOW', searchTerms: 'AGM-154 AGM154 JSOW joint standoff weapon glide weapon TOO PP', patterns: [/(?:联合防区外武器|AGM[\s-]*154|JSOW)/i],
    variants: [
      { id: 'agm-154a', label: 'AGM-154A JSOW（子弹药）', canonical: 'AGM-154A JSOW', searchTerms: 'AGM-154A JSOW submunition dispenser employment', patterns: [/AGM[\s-]*154A\b|A型?JSOW/i], evidencePatterns: [/AGM[\s-]*154A\b|JSOW[\s-]*A/i] },
      { id: 'agm-154c', label: 'AGM-154C JSOW（BROACH 单体战斗部）', canonical: 'AGM-154C JSOW', searchTerms: 'AGM-154C JSOW BROACH unitary penetrator employment', patterns: [/AGM[\s-]*154C\b|C型?JSOW/i], evidencePatterns: [/AGM[\s-]*154C\b|JSOW[\s-]*C|BROACH/i] },
    ],
  },
  { id: 'agr-20', canonical: 'AGR-20A APKWS', searchTerms: 'AGR-20 AGR20 APKWS laser guided Hydra rocket', patterns: [/(?:先进精确杀伤武器|激光制导火箭|AGR[\s-]*20A?|APKWS)/i] },
  {
    id: 'paveway', canonical: 'Paveway LGB（宝石路：GBU-10/12/16/24）', searchTerms: 'Paveway laser guided bomb LGB GBU-10 GBU-12 GBU-16 GBU-24 laser code delivery', patterns: [/(?:宝石路|Paveway|GBU[\s-]*(?:10|12|16|24)\b)/i],
    variants: [
      { id: 'paveway-ii', label: 'Paveway II：GBU-10/12/16', canonical: 'GBU-10/12/16 Paveway II', searchTerms: 'GBU-10 GBU-12 GBU-16 Paveway II laser guided bomb delivery', patterns: [/GBU[\s-]*(?:10|12|16)\b|Paveway[\s-]*II\b|二代宝石路/i], evidencePatterns: [/GBU[\s-]*(?:10|12|16)\b|Paveway[\s-]*II\b/i] },
      { id: 'paveway-iii', label: 'Paveway III：GBU-24', canonical: 'GBU-24 Paveway III', searchTerms: 'GBU-24 Paveway III laser guided bomb delivery profile', patterns: [/GBU[\s-]*24\b|Paveway[\s-]*III\b|三代宝石路/i], evidencePatterns: [/GBU[\s-]*24\b|Paveway[\s-]*III\b/i] },
    ],
  },
  { id: 'jdam', canonical: 'JDAM（GBU-31/32/38）', searchTerms: 'JDAM GPS INS guided bomb GBU-31 GBU-32 GBU-38 mission preplanned TOO coordinates', patterns: [/(?:[杰节捷截]达[姆母]|JDAM|GBU[\s-]*(?:31|32|38)\b)/i] },
  { id: 'gbu-54', canonical: 'GBU-54 LJDAM', searchTerms: 'GBU-54 LJDAM laser joint direct attack munition GPS laser guided bomb', patterns: [/(?:GBU[\s-]*54|LJDAM|激光[杰节捷截]达[姆母])/i] },
  { id: 'gbu-39', canonical: 'GBU-39 SDB', searchTerms: 'GBU-39 SDB small diameter bomb GPS guided bomb', patterns: [/(?:小直径炸弹|GBU[\s-]*39|\bSDB\b)/i] },
  {
    id: 'cbu', canonical: 'CBU cluster bomb / WCMD', searchTerms: 'CBU-52 CBU-87 CBU-97 CBU-99 CBU-103 CBU-105 cluster bomb WCMD wind corrected munitions dispenser', patterns: [/(?:集束炸弹|子母弹|风偏修正弹药|CBU[\s-]*(?:52|87|97|99|103|105)|WCMD)/i],
    variants: [
      { id: 'cbu-conventional', label: 'CBU-87/97（无制导集束弹）', canonical: 'CBU-87/CBU-97', searchTerms: 'CBU-87 CBU-97 unguided cluster bomb CCIP CCRP HOF RPM employment', patterns: [/CBU[\s-]*(?:87|97)\b|无制导集束/i], evidencePatterns: [/CBU[\s-]*(?:87|97)\b/i] },
      { id: 'cbu-wcmd', label: 'CBU-103/105（WCMD 风偏修正）', canonical: 'CBU-103/CBU-105 WCMD', searchTerms: 'CBU-103 CBU-105 WCMD wind corrected munitions dispenser INS employment', patterns: [/CBU[\s-]*(?:103|105)\b|\bWCMD\b|风偏修正/i], evidencePatterns: [/CBU[\s-]*(?:103|105)\b|\bWCMD\b/i] },
    ],
  },
  { id: 'mk-20', canonical: 'Mk-20 Rockeye', searchTerms: 'Mk-20 Rockeye cluster bomb anti armor', patterns: [/(?:石眼|Rockeye|MK[\s-]*20)/i] },
  { id: 'mk-80', canonical: 'Mk-80 series general-purpose bombs', searchTerms: 'Mk-81 Mk-82 Mk-83 Mk-84 general purpose unguided iron bomb slick Snakeye AIR', patterns: [/(?:铁炸弹|通用炸弹|MK[\s-]*(?:81|82|83|84)(?:AIR|Snakeeye)?)/i] },
  {
    id: 'hydra-70', canonical: 'Hydra 70 / FFAR rockets', searchTerms: 'Hydra 70 FFAR unguided rocket rocket pod M151 M229 M257 M274 smoke illumination flechette', patterns: [/(?:九头蛇|无控火箭|Hydra\s*70|\bFFAR\b)/i],
    variants: [
      { id: 'hydra-he', label: 'M151/M229（高爆战斗部）', canonical: 'Hydra M151/M229 HE', searchTerms: 'Hydra M151 M229 high explosive warhead rocket employment', patterns: [/\bM(?:151|229)\b|高爆(?:型|战斗部)?火箭/i], evidencePatterns: [/\bM(?:151|229)\b|high[\s-]*explosive/i] },
      { id: 'hydra-illum', label: 'M257（照明）', canonical: 'Hydra M257 illumination', searchTerms: 'Hydra M257 parachute illumination flare rocket employment', patterns: [/\bM257\b|照明(?:型)?火箭/i], evidencePatterns: [/\bM257\b|illumination.{0,16}rocket/i] },
      { id: 'hydra-training', label: 'M274（训练烟标）', canonical: 'Hydra M274 training smoke', searchTerms: 'Hydra M274 training smoke marker rocket', patterns: [/\bM274\b|训练烟(?:标)?火箭/i], evidencePatterns: [/\bM274\b|training[\s-]*smoke/i] },
    ],
  },
  { id: 'vikhr', canonical: 'Vikhr 9K121（旋风）', searchTerms: '9K121 Vikhr AT-16 laser beam riding anti tank missile', patterns: [/(?:旋风导弹|维赫尔|Vikhr|9K121|AT[\s-]*16)/i] },
  { id: 'kh-25-29', canonical: 'Kh-25 / Kh-29 air-to-ground missiles', searchTerms: 'Kh-25 Kh25 Kh-29 Kh29 AS-10 AS-14 laser TV guided air ground missile', patterns: [/(?:Kh|Х|Ch)[\s-]*(?:25|29)|AS[\s-]*(?:10|14)/i] },
  { id: 'kh-31-58', canonical: 'Kh-31 / Kh-58 anti-radiation missiles', searchTerms: 'Kh-31 Kh31 Kh-58 Kh58 AS-17 AS-11 anti radiation missile', patterns: [/(?:Kh|Х|Ch)[\s-]*(?:31|58)|AS[\s-]*(?:17|11)/i] },
  { id: 'sd-10', canonical: 'SD-10 active radar missile', searchTerms: 'SD-10 active radar air to air missile JF-17', patterns: [/(?:SD[\s-]*10|闪电十号)/i] },
  { id: 'ld-10', canonical: 'LD-10 anti-radiation missile', searchTerms: 'LD-10 anti radiation missile JF-17 SEAD', patterns: [/(?:LD[\s-]*10|雷电十号)/i] },
  { id: 'c-802', canonical: 'C-802AK / CM-802AKG anti-ship missile', searchTerms: 'C-802AK C802AK CM-802AKG CM802AKG anti ship man in the loop missile JF-17', patterns: [/(?:C[\s-]*802AK|CM[\s-]*802AKG|鹰击八三|鹰击83)/i] },
  { id: 'gb-6-ls-6', canonical: 'GB-6 / LS-6 glide bomb', searchTerms: 'GB-6 GB6 LS-6 LS6 glide bomb GPS guided JF-17', patterns: [/(?:GB[\s-]*6|LS[\s-]*6|雷石六号|雷石6)/i] },
  { id: 'brm-1', canonical: 'BRM-1 laser-guided rocket', searchTerms: 'BRM-1 BRM1 laser guided rocket JF-17', patterns: [/(?:BRM[\s-]*1|BRM1)/i] },
  { id: 'bk-90', canonical: 'BK 90 Mjölnir', searchTerms: 'BK 90 BK90 Mjolnir DWS 39 stand off submunition dispenser AJS-37', patterns: [/(?:BK\s*90|BK90|Mj[oö]lnir|雷神集束)/i] },
]

export function resolveWeaponVariantQuestion(question: string): WeaponVariantResolution[] {
  const normalized = question.normalize('NFKC')
  return DCS_WEAPON_ONTOLOGY.flatMap((family) => {
    if (!family.variants || !family.patterns.some((pattern) => pattern.test(normalized))) return []
    const explicitVariants = family.variants.filter((variant) => variant.patterns.some((pattern) => pattern.test(normalized)))
    return [{
      family,
      explicitVariants,
      ambiguousVariants: explicitVariants.length === 0 ? family.variants : [],
    }]
  })
}

export function weaponVariantEvidenceScore(variant: WeaponVariantSemantic, text: string): number {
  return variant.evidencePatterns.reduce((score, pattern) => score + (pattern.test(text) ? 1 : 0), 0)
}
