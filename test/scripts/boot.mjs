export default async function ({ shot, delay, stats }) {
  await delay(1500);
  console.log(JSON.stringify(await stats()));
  await shot('boot');
}
