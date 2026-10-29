# Anderson Rohr football captures

Source: **Free mocap pack 05: Soccer**, Anderson Rohr
https://andersonrohr.gumroad.com/l/mocap_pack5

Acquired through the creator's official Gumroad checkout at US$0. The owner's local archive contains the original ZIP and all 21 animations in Rokoko Default, iClone and UE5 variants (63 FBX files), plus the supplied import documentation. No receipt link, checkout email or raw FBX archive is included in this repository.

The creator permits personal and commercial projects and does not require attribution. Standalone redistribution, resale or repackaging of the animation pack is prohibited. The captures retain the creator's rights and are not relicensed as MIT software. This JSON is a runtime asset embedded in Pocket Football; do not extract or distribute it as an animation product.

The source FBX files evaluate at 60 FPS. Twelve selected sections are converted into `anderson-football.json` at the same sampling rate, with mirrored versions created at load time. Each section carries independent rest/parent-rest orientations. Four source spine segments are collapsed into the game's three-segment humanoid spine. Horizontal root displacement is driven by gameplay. Locomotion sections blend their final eight samples back into the first pose to close the loop.

| Runtime clip | Use |
|---|---|
| and_dribble_control | Slow close-control locomotion, blended by speed into the existing dribbling jog |
| and_pass | Stationary/slow side-foot pass |
| and_power | Moderate-speed strike; left-foot source mirrored for the right-foot action |
| and_penalty_1 | Stationary strike |
| and_penalty_2 | Strong stationary strike |
| and_gk_high | Anticipated high catch / block |
| and_gk_mid | Anticipated middle-height block |
| and_gk_low | Anticipated low gather |
| and_dribble_cut, and_dribble_run, and_defend, and_throw_in | Available library sections, reserved for further integration |

The goalkeeper sections are standing/hopping reaches and gathers. Existing lateral diving saves remain in use. A reach starts from predicted arrival time and height, with hand IK correcting for the target skeleton's proportions. Catch/parry outcomes still require the existing actual glove/body collision checks; the captured pose alone does not award a save.

Game validation covers pass/shot/chip contact, 30/60/120 Hz dribbling retention, high/mid/low keeper selection, a glove catch, six element variants and a 12-player match. The complete untrimmed source set remains local for future animation work.
