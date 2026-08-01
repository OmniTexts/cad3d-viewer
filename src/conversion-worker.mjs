// SPDX-License-Identifier: GPL-2.0-only

import { convertCadBuffer, createGlb } from "@omnitexts/cad3d-cli/browser";
import { modelDrawing } from "@omnitexts/cad3d-modeler";

self.addEventListener("message", async (event) => {
  const message = event.data;
  if (message?.type !== "convert") return;
  const { id, input, name, units } = message;

  try {
    progress(id, "parse", 0.08, "解析 CAD 图元");
    const drawing = await convertCadBuffer(input, {
      name,
      units,
      wasmDirectory: "/libredwg",
    });

    progress(id, "linework", 0.58, "生成分层线框");
    const lineworkGlb = await createGlb(drawing);

    progress(id, "analyze", 0.72, "识别建筑语义与参数");
    const { semanticModel, report, glb: solidGlb } = await modelDrawing(drawing);

    progress(id, "complete", 1, "模型准备完成");
    const result = {
      drawing: {
        source: drawing.source,
        units: drawing.units,
        statistics: drawing.statistics,
        layers: drawing.layers,
      },
      semanticModel,
      report,
      solidGlb,
      lineworkGlb,
    };
    const transfer = [lineworkGlb.buffer];
    if (solidGlb) transfer.push(solidGlb.buffer);
    self.postMessage({ type: "result", id, result }, transfer);
  } catch (error) {
    self.postMessage({
      type: "error",
      id,
      error: { name: error?.name ?? "Error", message: error?.message ?? String(error), stack: error?.stack ?? null },
    });
  }
});

function progress(id, stage, ratio, detail) {
  self.postMessage({ type: "progress", id, progress: { stage, ratio, detail } });
}
