import os

desktop = os.path.join(os.path.join(os.environ['USERPROFILE']), 'Desktop')
onedrive_desktop = os.path.join(os.path.join(os.environ['USERPROFILE']), 'OneDrive', 'Desktop')

if os.path.exists(onedrive_desktop):
    print(f"OneDrive Desktop found at: {onedrive_desktop}")
elif os.path.exists(desktop):
    print(f"Desktop found at: {desktop}")
else:
    print("Desktop not found in standard locations.")
