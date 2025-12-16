export const CONFIG = {
    colors: {
      bg: 0x050d1a,
      fog: 0x050d1a,
      champagneGold: 0xffd966,
      deepGreen: 0x03180a,
      accentRed: 0x990000,
    },
    particles: {
      count: 1500,
      dustCount: 2000,
      snowCount: 1000,
      treeHeight: 24,
      treeRadius: 8
    },
    camera: { z: 50 },
    audio: {
      // 默认音乐：Silent Night (钢琴版)
      // 如果需要更换，请直接在界面右上角点击音乐图标上传您的MP3文件
      bgmUrl: 'https://upload.wikimedia.org/wikipedia/commons/transcoded/6/6d/Silent_Night_-_piano.ogg/Silent_Night_-_piano.ogg.mp3'
    },
    preload: {
      images: []
    }
  };