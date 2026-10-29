# Supplemental football motion capture

Source: Rokoko, **Rokoko mocap: 12 free sports animations**
https://www.rokoko.com/resources/rokoko-mocap-12-free-sports-animations

The public download currently contains seven FBX files. Only Soccer_Passing_mixamo.fbx and Soccer_PenaltyKick_mixamo.fbx are used here. The official page permits personal and commercial game use and describes a Mixamo skeleton at 30 FPS. Source FBX files are kept in the owner's local asset archive, not republished as a standalone animation pack.

`precision-mocap.json` contains three cropped takes, each with its own source rest and parent-rest orientations. They are resampled at 60 Hz for interpolation; this does not create additional captured detail. Fingers are left to the existing character system. Horizontal root translation remains under gameplay control. Conversion uses Blender 4.5.3 FBX import, evaluated pose matrices and a Z-up to Y-up coordinate transform.

| Take | Source interval (seconds) | Measured contact (source seconds) |
|---|---|---|
| rokoko_pass | 2.80–4.25 | 3.22 |
| rokoko_pass_left | 9.00–10.80 | 9.64 |
| rokoko_penalty | 22.50–25.00 | 23.45 |

Each take receives a mirrored copy during retargeting. Stationary/slow side-foot passes use `rokoko_pass`, stationary strikes use `rokoko_penalty`, and the other existing moving strikes, chips and goalkeeper clips remain available. The separate left-foot source take is available in the library for future selection. Gameplay trims preparation to align the measured contact without accelerating the whole take; foot IK and a planted support boot finish the contact adjustment.

The original capture remains Rokoko content under its applicable terms, not the repository's MIT software license. New conversion, runtime contact and detail code follow the repository's software license.
