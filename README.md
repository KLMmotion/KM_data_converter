# data_lerobot

Convert raw recordings in BAG_STORAGE into a LeRobot dataset.

The pipeline has four stages: split the 2x2 camera video, export MCAP to RRD, align video with robot state and write a new RRD, then export the final LeRobot dataset.

## Input Layout

Each episode directory is expected to look like this:

```text
BAG_STORAGE/
  my_bag-yy-MM-dd-HH-mm-ss/
    data/
      data_0.mcap
    video/
      cameras.mp4
      cameras_first_frame.yaml
```

The default 2x2 layout of cameras.mp4 is:

```text
left_eye      right_eye
left_wrist    right_wrist
```

## Installation

Python 3.10 to 3.12 is recommended.

```powershell
pip install -e .
pip install rerun-sdk[all]
pip install -e .\examples\python\rerun_export
```

If your environment is still missing dependencies, install them as well:

```powershell
pip install opencv-python pyyaml
```

## Launch UI

The Electron UI provides a desktop window for running the full conversion workflow.

```powershell
cd .\km_data_converter_UI
npm install
npm run dev
```

Use the UI to select the `BAG_STORAGE` source directory, choose an output directory, set FPS, task text, and advanced options, then start the full pipeline. The window also shows conversion progress, live logs, the final dataset path, and a button to open the converted dataset in Rerun.

## Run Everything

Place all robot recordings named my_bag-yy-MM-dd-HH-mm-ss under BAG_STORAGE before running the pipeline.

```powershell
python -m km_data_converter run-full
```

You can also pass positional paths:

```powershell
python -m km_data_converter run-full <bag_storage_path> [output_root_path]
```

- `bag_storage_path`: required when not using `--bag-storage`
- `output_root_path`: optional output base directory
  - if provided, outputs go to:
    - `<output_root_path>/mcap2rrd`
    - `<output_root_path>/video2rrd`
    - `<output_root_path>/lerobot_output/lerobot_datasets-<earliest_bag_timestamp>`
  - if omitted, outputs default to `<bag_storage_path>/datasets`

Equivalent flag form:

```powershell
python -m km_data_converter run-full <bag_storage_path> --output-dir <output_root_path>
```

By default this will:

- Read all my_bag-yy-MM-dd-HH-mm-ss directories under BAG_STORAGE
- Generate intermediate outputs in datasets/mcap2rrd
- Generate intermediate outputs in datasets/video2rrd
- Write the final LeRobot dataset to datasets/lerobot_output

Common options:

```powershell
python -m km_data_converter run-full ^
  --bag-storage .\BAG_STORAGE ^
  --target-fps 10 ^
  --repo-id rerun/droid_lerobot_full ^
  --task-description "pick up the object and place it in the tray" ^
  --strict
```

This script runs the full conversion pipeline in one command and exports the data directly to LeRobot format.

- If --task-description is provided to run-full, that fixed string is written to every frame in the final LeRobot dataset.
- If --task-description is omitted, the final export reads task text from /language_instruction in each RRD.
- --target-fps is a shorter alias of --split-target-fps.

## Run Step by Step

You can also run each stage separately:

Split the tiled video:

```powershell
python -m km_data_converter split-video
```

This step splits the video and fixes the output FPS.

Export MCAP to RRD:

```powershell
python -m km_data_converter mcap-to-rrd --bag-storage .\BAG_STORAGE --output-dir .\datasets\mcap2rrd
```

`mcap-to-rrd` output path behavior:

- If `--output-dir` is omitted, output is written to `<bag_storage>\datasets\mcap2rrd`.
- If `--output-dir` already ends with `datasets\mcap2rrd`, files are written there.
- Otherwise it is treated as an output root, and files are written to `--output-dir\datasets\mcap2rrd`.

This step converts MCAP files to RRD.

Merge video and state into RRD:

```powershell
python -m km_data_converter video-to-rrd ^
  --bag-storage .\BAG_STORAGE ^
  --dataset-dir .\datasets\mcap2rrd ^
  --output-dir .\datasets\video2rrd
```

`video-to-rrd` dataset-dir behavior:

- If `--dataset-dir` is omitted, it tries `<bag_storage>\datasets\mcap2rrd` first, then `./datasets/mcap2rrd`.
- If `--dataset-dir` is provided as a root path, `datasets\mcap2rrd` is appended automatically.

`video-to-rrd` output-dir behavior:

- If `--output-dir` is omitted, output is written to `<bag_storage>\datasets\video2rrd`.
- If `--output-dir` is provided as a root path, `datasets\video2rrd` is appended automatically.

This step writes video streams into RRD and aligns them with robot state.

Export LeRobot:

```powershell
python -m km_data_converter rrd-to-lerobot ^
  --input-dir .\datasets\video2rrd ^
  --output-root .\datasets\lerobot_output\lerobot_datasets
```

If you want to override the task text for every frame manually instead of reading
it from the RRD's /language_instruction field:

```powershell
python -m km_data_converter rrd-to-lerobot ^
  --input-dir .\datasets\video2rrd ^
  --output-root .\datasets\lerobot_output\lerobot_datasets ^
  --task-description "pick up the object and place it in the tray"
```

`rrd-to-lerobot` output-root behavior:

- If `--output-root` is omitted, output is written under the input path's datasets folder:
  - input `...\datasets\video2rrd` -> output `...\datasets\lerobot_output\lerobot_datasets`
- If `--output-root` is provided as a root path, `datasets\lerobot_output\lerobot_datasets` is appended automatically.

`rrd-to-lerobot` input-dir behavior:

- If input ends with `video2rrd`, it is used directly.
- If input ends with `datasets`, `video2rrd` is appended.
- Otherwise, `datasets\video2rrd` is appended automatically.

This step converts the RRD files into LeRobot format.

- By default, task text is read from /language_instruction in each RRD.
- If --task-description is provided, that fixed string is written to every frame instead.

## Main Scripts

- `python -m km_data_converter run-full`: run the full pipeline end to end
- `python -m km_data_converter split-video`: split cameras.mp4 into four camera videos
- `python -m km_data_converter mcap-to-rrd`: export one mcap2rrd.rrd per episode
- `python -m km_data_converter video-to-rrd`: align video and robot state into video2rrd-yy-MM-dd-HH-mm-ss.rrd
- `python -m km_data_converter rrd-to-lerobot`: merge multiple RRD files into one LeRobot dataset

## Add URDF To RRD

If you want to augment an existing video2rrd file with the Marvin URDF and aligned joint transforms, run:

```powershell
python -m km_data_converter.urdf ^
  --input-rrd .\datasets\video2rrd\video2rrd-yy-MM-dd-HH-mm-ss.rrd ^
  --output-rrd .\datasets\video2rrd\video2rrd-yy-MM-dd-HH-mm-ss-with-urdf.rrd ^
  --no-spawn
```

Common behavior:

- `--input-rrd`: existing `video2rrd` file to augment
- `--output-rrd`: output RRD path; if omitted, a `-with-urdf.rrd` file is created next to the input file
- `--xacro`: optional path to the source xacro file; defaults to the Marvin M6 model in this repository
- `--output-urdf`: optional path for the expanded URDF file written before logging into Rerun
- `--no-spawn`: do not open a Rerun viewer automatically

This command converts a regular `video2rrd` file into a new RRD that also contains the expanded URDF plus aligned robot joint transforms.

## Action Definition

The action vector has 56 dimensions and is built in a fixed order:

- Dimensions 0-13: /joint_states/effort
- Dimensions 14-27: /joint_states/position
- Dimensions 28-41: /joint_states/velocity
- Dimensions 42-48: /control/joint_cmd_A
- Dimensions 49-55: /control/joint_cmd_B

Meaning:

- 0-13: joint effort
- 14-27: joint position
- 28-41: joint velocity
- 42-48: left arm control command
- 49-55: right arm control command

Layout:

```text
action = [effort(14), position(14), velocity(14), control_A(7), control_B(7)]
```

Left/right split:

- Dimensions 0-6: Joint_L effort
- Dimensions 7-13: Joint_R effort
- Dimensions 14-20: Joint_L position
- Dimensions 21-27: Joint_R position
- Dimensions 28-34: Joint_L velocity
- Dimensions 35-41: Joint_R velocity
- Dimensions 42-48: Joint_L control
- Dimensions 49-55: Joint_R control

Equivalent view:

```text
action = [Joint_L effort(7), Joint_R effort(7), Joint_L position(7), Joint_R position(7), Joint_L velocity(7), Joint_R velocity(7), Joint_L control(7), Joint_R control(7)]
```

## Observation.state Definition

observation.state has 26 dimensions and is built in a fixed order:

- Dimensions 0-6: /info/eef_left
- Dimensions 7-13: /info/eef_right
- Dimensions 14-19: /info/gripper_feedback_L
- Dimensions 20-25: /info/gripper_feedback_R

Layout:

```text
observation.state = [eef_left(7), eef_right(7), gripper_feedback_L(6), gripper_feedback_R(6)]
```

Meaning:

- eef_left: 7D left end-effector state
- eef_right: 7D right end-effector state
- gripper_feedback_L: 6D left gripper feedback
- gripper_feedback_R: 6D right gripper feedback

Field order:

- eef_left and eef_right: pose.position.x, pose.position.y, pose.position.z, pose.orientation.x, pose.orientation.y, pose.orientation.z, pose.orientation.w
- gripper_feedback_L and gripper_feedback_R: data[0], data[1], data[2], data[3], data[4], 0 

## Notes

- Each episode directory must start with my_bag-yy-MM-dd-HH-mm-ss
- video_to_rrd.py requires all four split video files to exist
- video_to_rrd.py also writes aligned sensor dashboard videos to each episode's video folder as sensor_0_dashboard.mp4 and sensor_1_dashboard.mp4
- rrd_to_lerobot.py expects state dimensions of eef_left=7, eef_right=7, gripper_L=6, gripper_R=6
- rrd_to_lerobot.py expects control dimensions of joint_cmd_A=7 and joint_cmd_B=7 in the action vector
- By default the scripts skip bad episodes and continue; with --strict they stop on the first error
- Save any RRD data you need in time. Converting new data can overwrite older files under datasets.
- Before converting new data, delete the old recordings in BAG_STORAGE.

## Output Directories

```text
datasets/
  mcap2rrd/
  video2rrd/
  lerobot_output/
```

The final LeRobot dataset usually contains data, meta, and videos.

## Visualize with Rerun

The converted LeRobot dataset can also be visualized in Rerun.

Install Rerun first:

```powershell
pip install rerun-sdk[all]
```

Then open a terminal in datasets\lerobot_output and run:

```powershell
rerun .\lerobot_datasets-yy-MM-dd-HH-mm-ss\
```

Replace yy-MM-dd-HH-mm-ss with the actual dataset timestamp folder name.
