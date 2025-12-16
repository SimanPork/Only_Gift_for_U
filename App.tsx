import React, { useState, useEffect, useRef } from 'react';
import SceneLogic from './components/SceneLogic';
import { CONFIG } from './constants';

const App: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [debugText, setDebugText] = useState("Initializing...");
  const [uiVisible, setUiVisible] = useState(true);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [isCameraVisible, setIsCameraVisible] = useState(true); 
  
  // Audio State
  const [isMusicPlaying, setIsMusicPlaying] = useState(false);
  const [musicSource, setMusicSource] = useState<string>(CONFIG.audio.bgmUrl);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    // Attempt to play audio on mount.
    const initAudio = async () => {
      if (audioRef.current) {
        audioRef.current.volume = 0.5;
        try {
          // Some browsers require interaction first, so this might fail silently
          await audioRef.current.play();
          setIsMusicPlaying(true);
        } catch (error) {
          console.log("Autoplay waiting for interaction");
          setIsMusicPlaying(false);
        }
      }
    };
    initAudio();
  }, []);

  // Watch for source changes to auto-play new tracks
  useEffect(() => {
    if (audioRef.current && musicSource !== CONFIG.audio.bgmUrl) {
      audioRef.current.play().then(() => setIsMusicPlaying(true)).catch(console.error);
    }
  }, [musicSource]);

  const toggleMusic = () => {
    if (!audioRef.current) return;
    
    if (isMusicPlaying) {
      audioRef.current.pause();
      setIsMusicPlaying(false);
    } else {
      audioRef.current.play();
      setIsMusicPlaying(true);
    }
  };

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setUploadedFiles(Array.from(e.target.files));
    }
  };

  const handleMusicUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const objectUrl = URL.createObjectURL(file);
      setMusicSource(objectUrl);
      setDebugText(`Music loaded: ${file.name}`);
    }
  };

  return (
    <div className="relative w-full h-screen bg-[#050d1a] overflow-hidden">
      {/* 
        Background Music 
        Dynamic source allows user to upload local MP3
      */}
      <audio 
        ref={audioRef} 
        src={musicSource} 
        loop 
        preload="auto" 
        onError={(e) => {
          console.warn("Audio source error, reverting to default or stopping.");
          setIsMusicPlaying(false);
        }}
      />

      {/* Loader */}
      <div className={`absolute top-0 left-0 w-full h-full z-[100] flex flex-col items-center justify-center bg-[#050d1a] transition-opacity duration-1000 ${loading ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        <div className="w-10 h-10 border border-yellow-500/20 border-t-yellow-500 rounded-full animate-spin mb-5"></div>
        <div className="text-yellow-500 text-sm tracking-[4px] uppercase font-light">Loading Memories</div>
      </div>

      {/* 3D Scene */}
      <SceneLogic 
        onLoadComplete={() => setLoading(false)} 
        onDebugUpdate={setDebugText}
        uploadedFiles={uploadedFiles}
        isCameraVisible={isCameraVisible}
      />

      {/* UI Overlay */}
      <div className={`absolute top-0 left-0 w-full h-full z-10 pointer-events-none flex flex-col items-center pt-10 px-4 transition-opacity duration-500 ${uiVisible ? 'opacity-100' : 'opacity-0'}`}>
        
        {/* Title */}
        <h1 className="text-4xl md:text-6xl text-transparent bg-clip-text bg-gradient-to-b from-white to-[#eebb66] font-['Cinzel'] tracking-widest text-center drop-shadow-[0_0_50px_rgba(252,238,167,0.6)]">
          Merry Christmas
        </h1>

        {/* Controls */}
        <div className="absolute top-5 right-5 pointer-events-auto flex flex-col gap-3 items-end">
           
           <div className="flex flex-row gap-2">
             {/* Music Upload Button */}
             <label className="w-8 h-8 md:w-10 md:h-10 rounded-full flex items-center justify-center border border-white/20 bg-black/40 text-white/60 hover:text-white hover:border-yellow-500 hover:bg-yellow-500/20 transition-all cursor-pointer backdrop-blur-sm" title="Change Music">
                <input type="file" accept="audio/*" onChange={handleMusicUpload} className="hidden" />
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 md:w-5 md:h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 18V5l12-2v13"></path>
                  <circle cx="6" cy="18" r="3"></circle>
                  <circle cx="18" cy="16" r="3"></circle>
                </svg>
             </label>

             {/* Play/Pause Toggle */}
             <button 
               onClick={toggleMusic}
               className={`w-8 h-8 md:w-10 md:h-10 rounded-full flex items-center justify-center border transition-all duration-300 backdrop-blur-sm ${isMusicPlaying ? 'border-yellow-500/60 bg-yellow-500/10 text-yellow-500 shadow-[0_0_15px_rgba(234,179,8,0.3)]' : 'border-white/20 bg-black/40 text-white/40 hover:text-white/80'}`}
               title={isMusicPlaying ? "Pause Music" : "Play Music"}
             >
               {isMusicPlaying ? (
                 <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 md:w-5 md:h-5" viewBox="0 0 24 24" fill="currentColor">
                   <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                 </svg>
               ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 md:w-5 md:h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="2" y1="2" x2="22" y2="22"></line>
                    <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                  </svg>
               )}
             </button>
           </div>

           {/* Upload Button */}
           <div className="flex flex-col gap-2 items-end">
              <label className="bg-black/60 border border-yellow-500/40 text-yellow-500 px-3 py-2 md:px-5 md:py-2 text-[10px] md:text-xs uppercase tracking-wider cursor-pointer hover:bg-yellow-500 hover:text-black transition-all backdrop-blur-sm rounded-sm text-center flex items-center justify-center min-w-[100px]">
                  Add Photos
                  <input type="file" multiple accept="image/*" onChange={handleFiles} className="hidden" />
              </label>

              {/* Camera Toggle Button */}
              <button 
                onClick={() => setIsCameraVisible(!isCameraVisible)}
                className="bg-black/60 border border-yellow-500/40 text-yellow-500/80 px-3 py-1 md:px-4 md:py-1 text-[9px] md:text-[10px] uppercase tracking-wider cursor-pointer hover:bg-yellow-500/20 hover:text-yellow-500 transition-all backdrop-blur-sm rounded-sm min-w-[100px]"
              >
                {isCameraVisible ? 'Hide Camera' : 'Show Camera'}
              </button>
           </div>
           
           <div className="text-yellow-500/50 text-[8px] md:text-[9px] uppercase tracking-widest text-right">
             Show hand to control
           </div>
        </div>
      </div>

      {/* Debug Info */}
      <div className="absolute bottom-1 left-1 md:bottom-2 md:left-2 text-yellow-500/80 text-[8px] md:text-[10px] font-mono bg-black/50 px-2 py-1 z-20 pointer-events-none rounded">
        {debugText}
      </div>
      
      {/* Mobile Toggle Hint */}
      <button 
        onClick={() => setUiVisible(!uiVisible)}
        className="absolute bottom-5 right-5 z-20 pointer-events-auto w-8 h-8 rounded-full border border-yellow-500/30 flex items-center justify-center text-yellow-500/50 text-xs md:hidden"
      >
        {uiVisible ? 'Hide' : 'Show'}
      </button>

    </div>
  );
};

export default App;