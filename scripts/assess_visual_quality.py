#!/usr/bin/env python3
"""
Assess visual quality of properties using CLIP embeddings.

Downloads property photos and scores them against text prompts describing
quality levels across three dimensions: condition/upkeep, finish level,
and overall aesthetic. Results are cached in data/visual_quality_cache.json.

Usage:
    python3 scripts/assess_visual_quality.py                # score all properties
    python3 scripts/assess_visual_quality.py --force         # re-score everything
    python3 scripts/assess_visual_quality.py --limit 50      # score up to 50 properties
"""

import argparse
import hashlib
import io
import json
import os
import time
import urllib.request
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
DATA_DIR = PROJECT_ROOT / "data"
CACHE_FILE = DATA_DIR / "visual_quality_cache.json"
PHOTO_CACHE_FILE = DATA_DIR / "photo_urls_cache.json"
DASHBOARD_DATA_FILE = DATA_DIR / "dashboard_data.json"

# Maximum photos to assess per property
MAX_PHOTOS = 5

# Quality dimension prompts (high/low pairs)
QUALITY_PROMPTS = {
    "condition": {
        "high": "a well-maintained home in excellent condition with no visible wear",
        "low": "a neglected home in poor condition with peeling paint, stains, and deferred maintenance",
    },
    "finish": {
        "high": "a luxury home interior with granite countertops, stainless steel appliances, hardwood floors, and designer fixtures",
        "low": "a basic home interior with laminate counters, old appliances, vinyl flooring, and builder-grade fixtures",
    },
    "aesthetic": {
        "high": "a beautiful, stylish home with modern design, excellent natural light, and tasteful decor",
        "low": "an unattractive, dated home with poor lighting, cluttered rooms, and outdated decor",
    },
}


def load_cache():
    """Load the visual quality cache."""
    if CACHE_FILE.exists():
        with open(CACHE_FILE) as f:
            return json.load(f)
    return {}


def save_cache(cache):
    """Save the visual quality cache."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(CACHE_FILE, "w") as f:
        json.dump(cache, f, indent=2)


def photo_hash(urls):
    """Compute a short hash of photo URLs to detect changes."""
    return hashlib.md5("|".join(sorted(urls)).encode()).hexdigest()[:8]


def select_photos(photo_urls):
    """Select 3-5 representative photos from a property's photo list.

    - If <= 3 photos: use all of them
    - If > 3 photos: take the first (exterior/hero) + evenly sample up to 4 more
    """
    if not photo_urls:
        return []
    if len(photo_urls) <= 3:
        return list(photo_urls)

    selected = [photo_urls[0]]  # Hero/exterior shot
    remaining = photo_urls[1:]
    # Evenly sample from remaining to get up to MAX_PHOTOS total
    count = min(MAX_PHOTOS - 1, len(remaining))
    if count > 0:
        step = max(1, len(remaining) // count)
        for i in range(0, len(remaining), step):
            if len(selected) >= MAX_PHOTOS:
                break
            selected.append(remaining[i])
    return selected


def download_image(url):
    """Download an image from a URL and return PIL Image."""
    from PIL import Image

    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (compatible; housing-data-pipeline/1.0)",
        })
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = resp.read()
        return Image.open(io.BytesIO(data)).convert("RGB")
    except Exception as e:
        print(f"    Failed to download {url[:80]}...: {e}")
        return None


def load_clip_model():
    """Load CLIP model and preprocessing. Returns (model, preprocess, tokenizer)."""
    import open_clip
    import torch

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"  Loading CLIP model (device: {device})...")

    model, _, preprocess = open_clip.create_model_and_transforms(
        "ViT-B-32", pretrained="laion2b_s34b_b79k"
    )
    model = model.to(device).eval()
    tokenizer = open_clip.get_tokenizer("ViT-B-32")

    return model, preprocess, tokenizer, device


def compute_text_embeddings(model, tokenizer, device):
    """Pre-compute text embeddings for all quality prompts."""
    import torch

    embeddings = {}
    for dim, prompts in QUALITY_PROMPTS.items():
        for level, text in prompts.items():
            tokens = tokenizer([text]).to(device)
            with torch.no_grad():
                emb = model.encode_text(tokens)
                emb = emb / emb.norm(dim=-1, keepdim=True)
            embeddings[f"{dim}_{level}"] = emb
    return embeddings


def score_image(model, preprocess, text_embeddings, image, device):
    """Score a single image across all quality dimensions.

    Returns dict with per-dimension scores (1-10 scale).
    """
    import torch

    img_tensor = preprocess(image).unsqueeze(0).to(device)
    with torch.no_grad():
        img_emb = model.encode_image(img_tensor)
        img_emb = img_emb / img_emb.norm(dim=-1, keepdim=True)

    scores = {}
    for dim in QUALITY_PROMPTS:
        high_emb = text_embeddings[f"{dim}_high"]
        low_emb = text_embeddings[f"{dim}_low"]

        high_sim = (img_emb @ high_emb.T).item()
        low_sim = (img_emb @ low_emb.T).item()

        # Map to 1-10 scale: ratio of high similarity to total
        score = (high_sim / (high_sim + low_sim)) * 10
        scores[dim] = round(max(1, min(10, score)), 1)

    return scores


def score_property(model, preprocess, tokenizer, text_embeddings, photo_urls, device):
    """Score a property by averaging scores across selected photos."""
    selected = select_photos(photo_urls)
    if not selected:
        return None

    all_scores = {"condition": [], "finish": [], "aesthetic": []}
    photos_scored = 0

    for url in selected:
        image = download_image(url)
        if image is None:
            continue

        scores = score_image(model, preprocess, text_embeddings, image, device)
        for dim in all_scores:
            all_scores[dim].append(scores[dim])
        photos_scored += 1

    if photos_scored == 0:
        return None

    # Average across photos
    result = {}
    for dim in all_scores:
        result[dim] = round(sum(all_scores[dim]) / len(all_scores[dim]), 1)

    result["score"] = round(
        sum(result[dim] for dim in QUALITY_PROMPTS) / len(QUALITY_PROMPTS), 1
    )
    result["photos_assessed"] = photos_scored
    result["assessed_at"] = datetime.now().isoformat()

    return result


def get_properties_to_score():
    """Load properties from dashboard_data.json that have photos."""
    if not DASHBOARD_DATA_FILE.exists():
        print("Warning: dashboard_data.json not found")
        return []

    with open(DASHBOARD_DATA_FILE) as f:
        data = json.load(f)

    properties = []
    for home in data.get("sold_homes", []) + data.get("active_listings", []):
        photos = home.get("photo_urls", [])
        if photos and home.get("address"):
            properties.append({
                "address": home["address"],
                "city": home.get("city", ""),
                "zip_code": home.get("zip_code", ""),
                "photo_urls": photos,
            })

    return properties


def main():
    parser = argparse.ArgumentParser(description="Assess visual quality of properties using CLIP.")
    parser.add_argument("--force", action="store_true", help="Re-score all properties")
    parser.add_argument("--limit", type=int, default=None, help="Max properties to score")
    args = parser.parse_args()

    print("=" * 60)
    print("Visual Quality Assessment (CLIP)")
    print("=" * 60)

    # Load properties
    print("\nLoading properties...")
    properties = get_properties_to_score()
    print(f"  Found {len(properties)} properties with photos")

    if not properties:
        print("No properties to score. Run the pipeline first to fetch photos.")
        return

    # Load cache
    cache = load_cache()
    print(f"  Cache has {len(cache)} entries")

    # Determine which properties need scoring
    to_score = []
    for prop in properties:
        key = prop["address"]
        ph = photo_hash(prop["photo_urls"])
        cached = cache.get(key)

        if args.force or not cached or cached.get("photo_hash") != ph:
            prop["_photo_hash"] = ph
            to_score.append(prop)

    print(f"  {len(to_score)} properties need scoring")

    if args.limit:
        to_score = to_score[:args.limit]
        print(f"  Limited to {len(to_score)} properties")

    if not to_score:
        print("All properties are up to date.")
        return

    # Load CLIP model
    print("\nInitializing CLIP model...")
    try:
        model, preprocess, tokenizer, device = load_clip_model()
    except ImportError as e:
        print(f"\nError: Required dependencies not installed: {e}")
        print("Install with: pip install open-clip-torch Pillow torch")
        print("Skipping visual quality assessment.")
        return

    # Pre-compute text embeddings
    print("  Computing text embeddings...")
    text_embeddings = compute_text_embeddings(model, tokenizer, device)

    # Score properties
    print(f"\nScoring {len(to_score)} properties...")
    scored = 0
    failed = 0
    start_time = time.time()

    for i, prop in enumerate(to_score):
        result = score_property(
            model, preprocess, tokenizer, text_embeddings,
            prop["photo_urls"], device
        )

        if result:
            result["photo_hash"] = prop["_photo_hash"]
            cache[prop["address"]] = result
            scored += 1
        else:
            failed += 1

        if (i + 1) % 10 == 0 or (i + 1) == len(to_score):
            elapsed = time.time() - start_time
            rate = (i + 1) / elapsed if elapsed > 0 else 0
            print(f"  [{i + 1}/{len(to_score)}] scored: {scored}, failed: {failed} ({rate:.1f} props/s)")

        # Save cache periodically
        if (i + 1) % 50 == 0:
            save_cache(cache)

    # Final save
    save_cache(cache)

    elapsed = time.time() - start_time
    print(f"\nDone! Scored {scored} properties in {elapsed:.0f}s ({failed} failed)")
    print(f"Cache now has {len(cache)} entries")


if __name__ == "__main__":
    main()
