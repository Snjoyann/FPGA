// LUT-ի օգտագործման շատ փոքր ուսումնական օրինակ։
const usedLuts = 240;
const totalLuts = 1_000;

const lutUsagePercent = (usedLuts / totalLuts) * 100;

console.log(`LUT usage: ${lutUsagePercent}%`);

// FF-ը կարող է հիշել մեկ bit՝ 0 կամ 1։
const storedBit: 0 | 1 = 1;

console.log(`FF stored bit: ${storedBit}`);

const usedFfs = 400;
const totalFfs = 2_000;

const ffUsagePercent = (usedFfs / totalFfs) * 100;

console.log(`FF usage: ${ffUsagePercent}%`);

const usedBrams = 6;
const totalBrams = 20;

const bramUsagePercent = (usedBrams / totalBrams) * 100;

console.log(`BRAM usage: ${bramUsagePercent}%`);

const usedDsps = 8;
const totalDsps = 40;

const dspUsagePercent = (usedDsps / totalDsps) * 100;

console.log(`DSP usage: ${dspUsagePercent}%`);

const timingSlackNs = -0.8;
const timingPassed = timingSlackNs >= 0;

console.log(`Timing passed: ${timingPassed}`);
