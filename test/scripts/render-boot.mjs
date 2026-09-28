// render smoke: boot, report stats, one screenshot from spawn
export default async function ({ shot, delay, stats, evalJs }) {
  await delay(1500);
  console.log(JSON.stringify(await stats()));
  await shot('boot');
}
