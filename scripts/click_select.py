# Click-select for the canvas toolbar (his ask 2026-10-22): one click on a piece of clothing -> SAM2 cuts
# exactly that object. Auto detection was tested first and failed on anime lingerie (yolov8x-worldv2 and
# deepfashion2 both boxed the whole girl), so the click is the prompt. Uses the sam2.1_b.pt ADetailer already has.
import base64
import os

import cv2
import numpy as np
from fastapi import Body
from modules import paths, script_callbacks

SAM_DIR = os.path.join(paths.models_path, "adetailer")
# Which SAM 2.1 to use. Default: the base model (sam2.1_b.pt). Opt in to the large one by putting sam2.1_l.pt into
# models/adetailer (it is then picked up automatically), or by setting FORGE_MASK_SAM=sam2.1_l.pt, in which case
# ultralytics downloads it by name the first time. Nothing changes for anyone who does neither.
SAM_NAME = os.environ.get("FORGE_MASK_SAM") or ("sam2.1_l.pt" if os.path.isfile(os.path.join(SAM_DIR, "sam2.1_l.pt")) else "sam2.1_b.pt")
SAM_PATH = os.path.join(SAM_DIR, SAM_NAME)
_sam = None  # ponytail: loaded on first click, kept for the session (~0.3 GB); re-embeds the image every click


def on_app_started(_, app):
    @app.post("/invert_mask/select")
    def select(body: dict = Body(...)):
        global _sam
        try:
            import torch
            from ultralytics import SAM

            if _sam is None:  # not in models/adetailer -> ultralytics downloads it by name once (base: ~160 MB)
                _sam = SAM(SAM_PATH if os.path.isfile(SAM_PATH) else SAM_NAME)
            raw = base64.b64decode(str(body["image"]).split(",", 1)[-1])
            img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
            h, w = img.shape[:2]
            pt = [int(body["x"]), int(body["y"])]
            r = _sam.predict(img, points=[pt], labels=[1], device="cuda" if torch.cuda.is_available() else "cpu", verbose=False)[0]
            if r.masks is None:
                return {"error": "nothing found there"}
            m = r.masks.data.cpu().numpy()
            m = cv2.resize(((m[0] if m.ndim == 3 else m) * 255).astype(np.uint8), (w, h))
            # grow ~1% so lace edges and the seam line are inside; paint more by hand if the body needs room
            k = max(3, int(min(h, w) * 0.01)) | 1
            m = cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
            png = cv2.imencode(".png", m)[1]
            return {"mask": "data:image/png;base64," + base64.b64encode(png).decode(), "coverage": round(float((m > 127).mean()), 3)}
        except Exception as e:
            return {"error": str(e)}


script_callbacks.on_app_started(on_app_started)
