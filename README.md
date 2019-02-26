# mpd-bridge

# Installation
This requires nodejs 8+.  
On Raspbian, install node manually by downloading it from http://nodejs.org/dist/v8.8.1/node-v8.8.1-linux-armv6l.tar.gz  
Clone the project in a folder of your choosing (e.g. /home/pi/code/mpd-bridge) and run 'npm install' to download the dependencies, and 'npm start' to run the bridge.  
Also ensure that the Music Player Daemon (MPD) is installed and running  

# Configuration
Currently the following parameters are hard-coded:
* MPD server: localhost:6600
* HTTP API: localhost:8080
* Fade-Time: 5 seconds
* Volume change steps: 5%

# Usage
* GET /mpd/fadePlay  
  Starts the playback with the volume fading from zero back to the initial value
* GET /mpd/fadeStop  
  Fades the volume from the initial value to zero, then stops the playback and restores the volume level
* GET /mpd/volUp  
  increases the volume
* GET /mpd/volDown  
  decreases the volume
