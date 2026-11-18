export function pipelineScrollPlan(heights: number[], available: number) {
  const height = Math.min(Math.max(...heights), Math.max(200, available));
  // Page scroll reveals tall content before the next horizontal handoff.
  const reading = heights.map((h) => Math.max(0, h - height));
  const hold = height * 0.3;
  const travel = Math.max(320, height * 0.75);
  const stops: number[] = [];
  const snapPoints: number[] = [];
  let duration = 0;
  reading.forEach((distance, index) => {
    stops.push(duration);
    snapPoints.push(duration, duration + distance);
    duration += distance + hold + (index < heights.length - 1 ? travel : 0);
  });
  snapPoints.push(duration);
  return { height, reading, hold, travel, stops, snapPoints, duration };
}
