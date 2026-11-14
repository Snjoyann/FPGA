// Քանի նախատեսված scenario-ից քանիսն է test run-ը փորձել։
const coveredScenarios = 60;
const totalScenarios = 80;

const isValid =
  totalScenarios > 0 &&
  coveredScenarios >= 0 &&
  coveredScenarios <= totalScenarios;

if (!isValid) {
  console.log("Invalid coverage data");
} else {
  const coveragePercent = (coveredScenarios / totalScenarios) * 100;

  console.log(`Coverage: ${coveragePercent}%`);
}
