export const DCS_ABBREVIATIONS = [
  'HMD', 'HMCS', 'JHMCS', 'IHADSS', 'HUD', 'HOTAS', 'ICP', 'DED', 'UFC', 'MFD', 'MPCD', 'OSB', 'HUD',
  'TACAN', 'ILS', 'ADF', 'NDB', 'INS', 'EGI', 'GPS', 'FCR', 'RWS', 'TWS', 'STT', 'ACM', 'SAM', 'MANPADS',
  'TGP', 'FLIR', 'CCD', 'SOI', 'SPI', 'LOS', 'RWR', 'ECM', 'ECCM', 'CMS', 'IFF', 'BVR', 'WVR', 'A-A', 'A-G',
  'CCIP', 'CCRP', 'DTOS', 'AUTO', 'FD', 'HARM', 'HTS', 'HAD', 'AMRAAM', 'JTAC', 'ROE', 'VID', 'RTB', 'AAR',
  'TDC', 'TMS', 'DMS', 'CMSP', 'DGFT', 'DGFT', 'CRM', 'MRM', 'SRM', 'VACQ', 'BORE', 'HOJ', 'RWR', 'SP', 'SB',
  'AG', 'AA', 'NAV', 'SEL', 'DESG', 'PRE', 'VVI', 'CAS', 'CNI', 'COMM1', 'COMM2', 'APU', 'BLEED', 'AVIONICS', 'SMS',
  'WPN', 'FCR', 'TGP', 'ENG', 'FUEL', 'GEAR', 'FLAP', 'BRAKE', 'THROTTLE', 'STICK', 'TRIM', 'PWR', 'AP', 'ATT', 'HDG', 'ALT',
  'MK', 'MK1', 'MK2', 'MK3', 'MK4', 'DUD', 'VT', 'PRI', 'SEC', 'QTY', 'INT', 'DEL', 'MODE', 'MASTER', 'ARM', 'SAFE',
  'C-130J', 'F/A-18C', 'F-16C', 'F-15E', 'F-15C', 'F-15', 'F-14B(U)', 'F-14BU', 'F-14B', 'F-14', 'F-4E', 'F-5E', 'F-86F',
  'A-10C', 'A-10C_2', 'A-10A', 'A-10', 'AH-64D', 'JF-17', 'AV-8B', 'Ka-50', 'Ka-52', 'Mi-24P', 'Mi-8MTV2',
  'MiG-29', 'MiG-21bis', 'MiG-19P', 'MiG-15bis', 'UH-1H', 'Su-25T', 'Su-27', 'Su-30', 'Su-33',
  'P-51D', 'P-47D', 'AJS-37', 'M-2000C', 'M-2000', 'Mirage F1', 'SA-342', 'CH-47F', 'OH-58D',
  'C-101CC', 'L-39ZA', 'Yak-52', 'MB-339', 'DH.98', 'Bf-109K-4', 'Fw-190A-8', 'Fw-190D-9', 'I-16',
  'F16', 'FA18', 'F18', 'F15', 'A10', 'AH64', 'AV8B', 'F14BU', 'F14', 'JF17', 'M2000', 'SU27', 'SU33', 'MIG29', 'F5',
  'AIM-9', 'AIM-120', 'AIM-7', 'AGM-65', 'AGM-88', 'GBU-12', 'GBU-24', 'GBU-31', 'GBU-38', 'GBU-39', 'CBU-97', 'Mk-82', 'Mk-84', 'Hydra',
] as const

/**
 * SenseVoice may render spoken English designations as ordinary words
 * ("F fourteen" -> "iPhone") or mix Latin letters with Chinese numerals.
 * Keep these corrections ahead of the generic acronym pass and order the
 * most specific variants before their shorter aircraft family.
 */
export const DCS_AIRCRAFT_SPEECH_ALIASES: ReadonlyArray<readonly [RegExp, string]> = [
  [/(?<![a-z0-9])f\s*[-/]?\s*14\s*(?:b\s*)?(?:u|upgrade)(?=$|[^a-z0-9])/giu, 'F-14B(U)'],
  [/(?<![a-z0-9])f\s*[-/]?\s*14\s*b(?=$|[^a-z0-9])/giu, 'F-14B'],
  [/(?<![a-z0-9])(?:i\s*phone|eye\s*phone|爱\s*疯|f\s*[-/]?\s*(?:14|十四|一四|幺四|fourteen))(?=$|[^a-z0-9])/giu, 'F-14'],
  [/(?<![a-z0-9])(?:f\s*[/_-]?\s*a\s*[/_-]?\s*(?:18|十八|一八|幺八|eighteen)\s*c?|f\s*[-/]?\s*(?:18|十八|一八|幺八|eighteen)|hornet)(?=$|[^a-z0-9])/giu, 'F/A-18C'],
  [/(?<![a-z0-9])(?:f\s*[-/]?\s*(?:16|十六|一六|幺六|sixteen)|viper)(?=$|[^a-z0-9])/giu, 'F-16C'],
  [/(?<![a-z0-9])f\s*[-/]?\s*(?:15|十五|一五|幺五|fifteen)\s*e(?=$|[^a-z0-9])/giu, 'F-15E'],
  [/(?<![a-z0-9])f\s*[-/]?\s*(?:15|十五|一五|幺五|fifteen)\s*c(?=$|[^a-z0-9])/giu, 'F-15C'],
  [/(?<![a-z0-9])f\s*[-/]?\s*(?:15|十五|一五|幺五|fifteen)(?=$|[^a-z0-9])/giu, 'F-15'],
  [/(?<![a-z0-9])f\s*[-/]?\s*(?:4|四|four)\s*e(?=$|[^a-z0-9])/giu, 'F-4E'],
  [/(?<![a-z0-9])f\s*[-/]?\s*(?:5|五|five)\s*e?(?=$|[^a-z0-9])/giu, 'F-5E'],
  [/(?<![a-z0-9])f\s*[-/]?\s*(?:86|八六|八十六|eighty[\s-]*six)\s*f?(?=$|[^a-z0-9])/giu, 'F-86F'],
  [/(?<![a-z0-9])a\s*[-/]?\s*(?:10|十|一零|幺零|ten)\s*c(?=$|[^a-z0-9])/giu, 'A-10C'],
  [/(?<![a-z0-9])a\s*[-/]?\s*(?:10|十|一零|幺零|ten)\s*a(?=$|[^a-z0-9])/giu, 'A-10A'],
  [/(?<![a-z0-9])a\s*[-/]?\s*(?:10|十|一零|幺零|ten)(?=$|[^a-z0-9])/giu, 'A-10'],
  [/(?<![a-z0-9])a\s*h\s*[-/]?\s*(?:64|六四|六十四|sixty[\s-]*four)\s*d?(?=$|[^a-z0-9])/giu, 'AH-64D'],
  [/(?<![a-z0-9])j\s*f\s*[-/]?\s*(?:17|十七|一七|幺七|seventeen)(?=$|[^a-z0-9])/giu, 'JF-17'],
  [/(?<![a-z0-9])a\s*v\s*[-/]?\s*(?:8|八|eight)\s*b?(?=$|[^a-z0-9])/giu, 'AV-8B'],
  [/(?<![a-z0-9])c\s*[-/]?\s*(?:130|一三零|幺三零|one[\s-]*thirty)\s*j?(?=$|[^a-z0-9])/giu, 'C-130J'],
  [/(?<![a-z0-9])k\s*a\s*[-/]?\s*(?:50|五零|五十|fifty)(?=$|[^a-z0-9])/giu, 'Ka-50'],
  [/(?<![a-z0-9])k\s*a\s*[-/]?\s*(?:52|五二|五十二|fifty[\s-]*two)(?=$|[^a-z0-9])/giu, 'Ka-52'],
  [/(?<![a-z0-9])m\s*i\s*[-/]?\s*(?:24|二四|二十四|twenty[\s-]*four)\s*p?(?=$|[^a-z0-9])/giu, 'Mi-24P'],
  [/(?<![a-z0-9])m\s*i\s*[-/]?\s*(?:8|八|eight)(?:\s*m\s*t\s*v\s*2)?(?=$|[^a-z0-9])/giu, 'Mi-8MTV2'],
  [/(?<![a-z0-9])m\s*i\s*g\s*[-/]?\s*(?:29|二九|二十九|twenty[\s-]*nine)(?=$|[^a-z0-9])/giu, 'MiG-29'],
  [/(?<![a-z0-9])m\s*i\s*g\s*[-/]?\s*(?:21|二一|二十一|twenty[\s-]*one)(?:\s*bis)?(?=$|[^a-z0-9])/giu, 'MiG-21bis'],
  [/(?<![a-z0-9])m\s*i\s*g\s*[-/]?\s*(?:19|一九|十九|nineteen)\s*p?(?=$|[^a-z0-9])/giu, 'MiG-19P'],
  [/(?<![a-z0-9])m\s*i\s*g\s*[-/]?\s*(?:15|一五|十五|fifteen)(?:\s*bis)?(?=$|[^a-z0-9])/giu, 'MiG-15bis'],
  [/(?<![a-z0-9])s\s*u\s*[-/]?\s*(?:25|二五|二十五|twenty[\s-]*five)\s*t?(?=$|[^a-z0-9])/giu, 'Su-25T'],
  [/(?<![a-z0-9])s\s*u\s*[-/]?\s*(?:27|二七|二十七|twenty[\s-]*seven)(?=$|[^a-z0-9])/giu, 'Su-27'],
  [/(?<![a-z0-9])s\s*u\s*[-/]?\s*(?:30|三零|三十|thirty)(?=$|[^a-z0-9])/giu, 'Su-30'],
  [/(?<![a-z0-9])s\s*u\s*[-/]?\s*(?:33|三三|三十三|thirty[\s-]*three)(?=$|[^a-z0-9])/giu, 'Su-33'],
  [/(?<![a-z0-9])u\s*h\s*[-/]?\s*(?:1|一|one)\s*h?(?=$|[^a-z0-9])/giu, 'UH-1H'],
  [/(?<![a-z0-9])c\s*h\s*[-/]?\s*(?:47|四七|四十七|forty[\s-]*seven)\s*f?(?=$|[^a-z0-9])/giu, 'CH-47F'],
  [/(?<![a-z0-9])o\s*h\s*[-/]?\s*(?:58|五八|五十八|fifty[\s-]*eight)\s*d?(?=$|[^a-z0-9])/giu, 'OH-58D'],
  [/(?<![a-z0-9])a\s*j\s*s\s*[-/]?\s*(?:37|三七|三十七|thirty[\s-]*seven)(?=$|[^a-z0-9])/giu, 'AJS-37'],
  [/(?<![a-z0-9])(?:m\s*[-/]?\s*(?:2000|两千|二千|two[\s-]*thousand)|mirage\s*(?:2000|two[\s-]*thousand))\s*c?(?=$|[^a-z0-9])/giu, 'M-2000C'],
  [/(?<![a-z0-9])mirage\s*f\s*(?:1|一|one)(?=$|[^a-z0-9])/giu, 'Mirage F1'],
  [/(?<![a-z0-9])s\s*a\s*[-/]?\s*(?:342|三四二|three[\s-]*forty[\s-]*two)(?=$|[^a-z0-9])/giu, 'SA-342'],
  [/(?<![a-z0-9])p\s*[-/]?\s*(?:51|五一|五十一|fifty[\s-]*one)\s*d?(?=$|[^a-z0-9])/giu, 'P-51D'],
  [/(?<![a-z0-9])p\s*[-/]?\s*(?:47|四七|四十七|forty[\s-]*seven)\s*d?(?=$|[^a-z0-9])/giu, 'P-47D'],
  [/(?<![a-z0-9])c\s*[-/]?\s*(?:101|一零一|幺零幺|one[\s-]*(?:oh|zero)[\s-]*one)(?:\s*c\s*c)?(?=$|[^a-z0-9])/giu, 'C-101CC'],
  [/(?<![a-z0-9])l\s*[-/]?\s*(?:39|三九|三十九|thirty[\s-]*nine)(?:\s*z\s*a)?(?=$|[^a-z0-9])/giu, 'L-39ZA'],
  [/(?<![a-z0-9])yak\s*[-/]?\s*(?:52|五二|五十二|fifty[\s-]*two)(?=$|[^a-z0-9])/giu, 'Yak-52'],
  [/(?<![a-z0-9])m\s*b\s*[-/]?\s*(?:339|三三九|three[\s-]*thirty[\s-]*nine)(?=$|[^a-z0-9])/giu, 'MB-339'],
  [/(?<![a-z0-9])d\s*h\s*[./_-]?\s*(?:98|九八|九十八|ninety[\s-]*eight)(?=$|[^a-z0-9])/giu, 'DH.98'],
  [/(?<![a-z0-9])b\s*f\s*[-/]?\s*(?:109|一零九|幺零九|one[\s-]*(?:oh|zero)[\s-]*nine)(?:\s*k\s*4)?(?=$|[^a-z0-9])/giu, 'Bf-109K-4'],
  [/(?<![a-z0-9])f\s*w\s*[-/]?\s*(?:190|一九零|幺九零|one[\s-]*ninety)\s*a\s*8(?=$|[^a-z0-9])/giu, 'Fw-190A-8'],
  [/(?<![a-z0-9])f\s*w\s*[-/]?\s*(?:190|一九零|幺九零|one[\s-]*ninety)\s*d\s*9(?=$|[^a-z0-9])/giu, 'Fw-190D-9'],
  [/(?<![a-z0-9])i\s*[-/]?\s*(?:16|十六|一六|幺六|sixteen)(?=$|[^a-z0-9])/giu, 'I-16'],
]

export const DCS_SPEECH_CANONICAL_ALIASES: ReadonlyArray<readonly [RegExp, string]> = [
  [/激光[杰节捷截]达[姆母]/gu, 'LJDAM'],
  [/[杰节捷截]达[姆母]/gu, 'JDAM'],
  [/塔康/gu, 'TACAN'],
  [/哈姆(?:导弹)?/gu, 'HARM'],
  [/阿姆拉姆/gu, 'AMRAAM'],
  [/乔治\s*(?:AI|人工智能)?/giu, 'George AI'],
  [/杰斯特/gu, 'Jester'],
  [/彼得罗维奇/gu, 'Petrovich'],
  [/小牛导弹/gu, 'Maverick'],
]

export function normalizeDcsTerminologyInput(value: string): string {
  let result = value.normalize('NFKC')
  for (const [pattern, replacement] of DCS_AIRCRAFT_SPEECH_ALIASES) {
    result = result.replace(pattern, replacement)
  }
  for (const [pattern, replacement] of DCS_SPEECH_CANONICAL_ALIASES) {
    result = result.replace(pattern, replacement)
  }
  return result
}
