#!/usr/bin/env python3
"""
UI Grafic pentru Dynamic Captions Generator
Interfață modernă și scalabilă pentru generarea de captions dinamice

Autor: AI Assistant pentru workflow ElevenLabs
"""

import tkinter as tk
from tkinter import ttk, filedialog, messagebox, scrolledtext
import tkinter.font as tkfont
import os
import threading
import json
from pathlib import Path
import subprocess
import sys
from datetime import datetime
from caption_preview import CaptionPreviewWindow

# Setez FFmpeg în PATH dacă există
def setup_ffmpeg_path():
    """Setează FFmpeg în PATH dacă este instalat cu winget"""
    ffmpeg_path = os.path.join(
        os.environ.get('LOCALAPPDATA', ''),
        'Microsoft', 'WinGet', 'Packages', 
        'Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe',
        'ffmpeg-8.0-full_build', 'bin'
    )
    
    if os.path.exists(ffmpeg_path):
        current_path = os.environ.get('PATH', '')
        if ffmpeg_path not in current_path:
            os.environ['PATH'] = current_path + os.pathsep + ffmpeg_path
            print(f"FFmpeg adaugat la PATH: {ffmpeg_path}")
        return True
    return False

# Configurez FFmpeg
setup_ffmpeg_path()

# Try to import drag and drop, but make it optional
try:
    from tkinterdnd2 import DND_FILES, TkinterDnD
    HAS_DND = True
except ImportError:
    HAS_DND = False

# Importăm generatorul nostru
try:
    from dynamic_captions import DynamicCaptionsGenerator
except ImportError:
    # Show error only if we have tkinter available
    try:
        import tkinter as tk
        root = tk.Tk()
        root.withdraw()
        messagebox.showerror("Eroare", "Nu pot importa dynamic_captions.py!\nAsigură-te că fișierul există în același director.")
        root.destroy()
    except:
        print("❌ Nu pot importa dynamic_captions.py!")
    sys.exit(1)


class CaptionUI:
    def __init__(self, root):
        self.root = root
        self.root.title("🎬 Dynamic Captions Generator")
        # Setez fereastra să se deschidă maximizată
        try:
            self.root.state('zoomed')  # Windows
        except tk.TclError:
            # Pentru Linux/Mac
            self.root.attributes('-zoomed', True)
        self.root.minsize(800, 600)
        
        # Setez iconița și tema
        self.setup_theme()
        
        # Variables
        self.audio_file = tk.StringVar()
        self.original_text = tk.StringVar()  # Textul original din ElevenLabs
        # Asigură-te că folderul implicit există și e valid
        try:
            default_folder = os.getcwd()
            if not os.path.exists(default_folder):
                default_folder = os.path.expanduser("~")  # Home folder ca fallback
        except:
            default_folder = os.path.expanduser("~")  # Home folder ca fallback
        self.output_folder = tk.StringVar(value=default_folder)
        self.words_per_caption = tk.IntVar(value=2)
        self.min_duration = tk.DoubleVar(value=0.6)
        self.max_duration = tk.DoubleVar(value=3.0)
        self.model_name = tk.StringVar(value="base")
        self.output_formats = {
            'SRT': tk.BooleanVar(value=True),
            'VTT': tk.BooleanVar(value=False),
            'JSON': tk.BooleanVar(value=False),
            'CSV': tk.BooleanVar(value=False)
        }
        # Opțiuni pentru formatarea textului
        self.remove_punctuation = tk.BooleanVar(value=False)
        self.text_case = tk.StringVar(value="normal")
        
        self.generator = None
        self.is_processing = False
        self.last_generated_captions = None
        self.last_original_text = None

        # Config file pentru salvarea setărilor
        self.config_file = Path("caption_config.json")

        self.load_config()
        self.create_ui()

        # Salvează config la schimbarea setărilor
        self.setup_config_auto_save()
        
    def setup_theme(self):
        """Configurez tema modernă"""
        # Style pentru ttk widgets
        style = ttk.Style()
        style.theme_use('clam')
        
        # Culori moderne
        style.configure('Title.TLabel', font=('Segoe UI', 16, 'bold'), foreground='#2c3e50')
        style.configure('Subtitle.TLabel', font=('Segoe UI', 10, 'bold'), foreground='#34495e')
        style.configure('Info.TLabel', font=('Segoe UI', 9), foreground='#7f8c8d')
        
        # Butoane moderne
        style.configure('Modern.TButton', font=('Segoe UI', 10, 'bold'), padding=(10, 5))
        style.configure('Success.TButton', font=('Segoe UI', 10, 'bold'), foreground='white')
        
        # Frame-uri cu margini
        style.configure('Card.TFrame', relief='solid', borderwidth=1)
        
    def create_ui(self):
        """Creez interfața scalabilă cu layout în 2 coloane"""
        # Configure grid weights pentru scalare
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(0, weight=1)

        # Main container cu scrolling
        main_frame = ttk.Frame(self.root)
        main_frame.grid(row=0, column=0, sticky="nsew", padx=10, pady=10)
        main_frame.columnconfigure(0, weight=1)
        main_frame.columnconfigure(1, weight=1)

        # Title - span across both columns
        title_label = ttk.Label(main_frame, text="🎬 Dynamic Captions Generator", style='Title.TLabel')
        title_label.grid(row=0, column=0, columnspan=2, pady=(0, 20), sticky="ew")

        # LEFT COLUMN - Input and Text
        left_frame = ttk.Frame(main_frame)
        left_frame.grid(row=1, column=0, sticky="nsew", padx=(0, 5))
        left_frame.columnconfigure(0, weight=1)

        # File Input Section
        self.create_file_section(left_frame, 0)

        # Original Text Section (pentru comparare și corectare)
        self.create_original_text_section(left_frame, 1)

        # RIGHT COLUMN - Settings and Output
        right_frame = ttk.Frame(main_frame)
        right_frame.grid(row=1, column=1, sticky="nsew", padx=(5, 0))
        right_frame.columnconfigure(0, weight=1)

        # Settings Section
        self.create_settings_section(right_frame, 0)

        # Output Formats Section
        self.create_formats_section(right_frame, 1)

        # Output Folder Section
        self.create_output_folder_section(right_frame, 2)

        # Action Buttons - span across both columns
        self.create_buttons_section(main_frame, 2)

        # Progress and Output - span across both columns
        self.create_output_section(main_frame, 3)

        # Configure row weights
        main_frame.rowconfigure(1, weight=1)  # Main content expandable
        main_frame.rowconfigure(2, weight=0)  # Buttons fixed
        main_frame.rowconfigure(3, weight=1)  # Output section expandable

        # Configure column frame weights
        for i in range(3):
            left_frame.rowconfigure(i, weight=0)
        left_frame.rowconfigure(1, weight=1)  # Text section expandable

        for i in range(4):
            right_frame.rowconfigure(i, weight=0)
        
    def create_file_section(self, parent, row):
        """Secțiunea pentru selecția fișierului audio"""
        frame = ttk.LabelFrame(parent, text="📁 Fișier Audio", padding=15, style='Card.TFrame')
        frame.grid(row=row, column=0, sticky="ew", pady=(0, 10))
        frame.columnconfigure(1, weight=1)
        
        # Drag & Drop zone (optional)
        if HAS_DND:
            self.drop_zone = tk.Frame(frame, bg='#ecf0f1', relief='ridge', bd=2, height=80)
            self.drop_zone.grid(row=0, column=0, columnspan=3, sticky="ew", pady=(0, 10))
            self.drop_zone.columnconfigure(0, weight=1)
            
            # Enable drag and drop
            self.drop_zone.drop_target_register(DND_FILES)
            self.drop_zone.dnd_bind('<<Drop>>', self.on_file_drop)
            
            drop_text = "🎵 Drag & Drop fișierul audio/video aici\n(MP3, WAV, M4A, FLAC, OGG, AAC, MP4, AVI)\nsau folosește butonul Browse"
        else:
            self.drop_zone = tk.Frame(frame, bg='#ecf0f1', relief='sunken', bd=2, height=60)
            self.drop_zone.grid(row=0, column=0, columnspan=3, sticky="ew", pady=(0, 10))
            self.drop_zone.columnconfigure(0, weight=1)
            
            drop_text = "🎵 Folosește butonul Browse pentru a selecta\nfișierul audio/video (toate formatele)"
            
        drop_label = tk.Label(self.drop_zone, text=drop_text, 
                            bg='#ecf0f1', font=('Segoe UI', 10), fg='#7f8c8d')
        drop_label.grid(row=0, column=0, pady=15)
        
        # File path entry
        ttk.Label(frame, text="Fișier selectat:").grid(row=1, column=0, sticky="w", pady=5)
        self.file_entry = ttk.Entry(frame, textvariable=self.audio_file, font=('Segoe UI', 10))
        self.file_entry.grid(row=1, column=1, sticky="ew", padx=(5, 5), pady=5)
        
        ttk.Button(frame, text="Browse...", command=self.browse_file, style='Modern.TButton').grid(row=1, column=2, padx=(5, 0), pady=5)
        
        # Info despre formate
        info_label = ttk.Label(frame, text="💡 Toate formatele: MP3, WAV, M4A, FLAC, OGG, AAC, WMA, MP4, AVI, MKV, MOV", 
                             style='Info.TLabel')
        info_label.grid(row=2, column=0, columnspan=3, sticky="w", pady=(5, 0))
        
    def create_original_text_section(self, parent, row):
        """Secțiunea pentru textul original din ElevenLabs"""
        frame = ttk.LabelFrame(parent, text="📝 Text Original ElevenLabs (pentru corectare automată)",
                             padding=15, style='Card.TFrame')
        frame.grid(row=row, column=0, sticky="ew", pady=(0, 10))
        frame.columnconfigure(0, weight=1)

        # Info label
        info_label = ttk.Label(frame,
                             text="💡 Inserează aici textul original folosit în ElevenLabs pentru corectarea automată a cuvintelor",
                             style='Info.TLabel')
        info_label.grid(row=0, column=0, sticky="w", pady=(0, 10))

        # Text area cu scroll
        text_frame = ttk.Frame(frame)
        text_frame.grid(row=1, column=0, sticky="ew")
        text_frame.columnconfigure(0, weight=1)

        self.original_text_widget = scrolledtext.ScrolledText(
            text_frame,
            height=6,
            wrap=tk.WORD,
            font=('Segoe UI', 10),
            bg='#f8f9fa',
            fg='#2c3e50'
        )
        self.original_text_widget.grid(row=0, column=0, sticky="ew")

        # Placeholder text
        placeholder_text = "Paste aici textul pe care l-ai folosit în ElevenLabs..."
        self.original_text_widget.insert('1.0', placeholder_text)
        self.original_text_widget.config(fg='#95a5a6')

        # Event handlers pentru placeholder
        def on_focus_in(event):
            if self.original_text_widget.get('1.0', tk.END).strip() == placeholder_text:
                self.original_text_widget.delete('1.0', tk.END)
                self.original_text_widget.config(fg='#2c3e50')

        def on_focus_out(event):
            if not self.original_text_widget.get('1.0', tk.END).strip():
                self.original_text_widget.insert('1.0', placeholder_text)
                self.original_text_widget.config(fg='#95a5a6')

        self.original_text_widget.bind('<FocusIn>', on_focus_in)
        self.original_text_widget.bind('<FocusOut>', on_focus_out)

        # Buttons frame
        button_frame = ttk.Frame(frame)
        button_frame.grid(row=2, column=0, sticky="w", pady=(10, 0))

        ttk.Button(button_frame, text="📋 Lipește din Clipboard",
                  command=self.paste_from_clipboard).grid(row=0, column=0, padx=(0, 5))

        ttk.Button(button_frame, text="🔄 Curăță Text",
                  command=self.clear_original_text).grid(row=0, column=1, padx=5)

        ttk.Button(button_frame, text="📄 Încarcă din Fișier",
                  command=self.load_text_from_file).grid(row=0, column=2, padx=5)

        # Checkbox pentru activare corectare
        self.use_original_text = tk.BooleanVar(value=True)
        self.correction_cb = ttk.Checkbutton(
            frame,
            text="✅ Folosește textul original pentru corectarea automată a cuvintelor",
            variable=self.use_original_text
        )
        self.correction_cb.grid(row=3, column=0, sticky="w", pady=(10, 0))

        # Stats label
        self.text_stats_label = ttk.Label(frame, text="0 cuvinte • 0 caractere", style='Info.TLabel')
        self.text_stats_label.grid(row=4, column=0, sticky="w", pady=(5, 0))

        # Bind pentru update stats și auto-save
        def on_text_change(event=None):
            self.update_text_stats(event)
            # Delay auto-save pentru a nu salva la fiecare taste
            self.root.after(1000, self.save_config)

        self.original_text_widget.bind('<KeyRelease>', on_text_change)
        self.original_text_widget.bind('<FocusOut>', lambda e: self.save_config())

    def paste_from_clipboard(self):
        """Lipește text din clipboard"""
        try:
            text = self.root.clipboard_get()
            if text:
                # Clear placeholder
                current_text = self.original_text_widget.get('1.0', tk.END).strip()
                if current_text == "Paste aici textul pe care l-ai folosit în ElevenLabs...":
                    self.original_text_widget.delete('1.0', tk.END)
                    self.original_text_widget.config(fg='#2c3e50')
                else:
                    # Add to existing text
                    self.original_text_widget.insert(tk.END, '\n')

                self.original_text_widget.insert(tk.END, text)
                self.update_text_stats()
                self.save_config()  # Salvează automat
                self.log_message("📋 Text lipit din clipboard")
        except:
            messagebox.showwarning("Avertisment", "Nu am găsit text în clipboard!")

    def clear_original_text(self):
        """Curăță textul original"""
        self.original_text_widget.delete('1.0', tk.END)
        self.original_text_widget.insert('1.0', "Paste aici textul pe care l-ai folosit în ElevenLabs...")
        self.original_text_widget.config(fg='#95a5a6')
        self.text_stats_label.config(text="0 cuvinte • 0 caractere")
        self.save_config()  # Salvează automat
        self.log_message("🔄 Text original curățat")

    def load_text_from_file(self):
        """Încarcă text dintr-un fișier"""
        file_path = filedialog.askopenfilename(
            title="Selectează fișierul text",
            filetypes=[
                ("Fișiere text", "*.txt"),
                ("Toate fișierele", "*.*")
            ]
        )
        if file_path:
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    text = f.read()

                # Clear placeholder
                current_text = self.original_text_widget.get('1.0', tk.END).strip()
                if current_text == "Paste aici textul pe care l-ai folosit în ElevenLabs...":
                    self.original_text_widget.delete('1.0', tk.END)
                    self.original_text_widget.config(fg='#2c3e50')

                self.original_text_widget.insert('1.0', text)
                self.update_text_stats()
                self.save_config()  # Salvează automat
                self.log_message(f"📄 Text încărcat din: {os.path.basename(file_path)}")
            except Exception as e:
                messagebox.showerror("Eroare", f"Nu pot citi fișierul:\n{e}")

    def update_text_stats(self, event=None):
        """Actualizează statisticile textului"""
        text = self.original_text_widget.get('1.0', tk.END).strip()
        if text != "Paste aici textul pe care l-ai folosit în ElevenLabs...":
            words = len(text.split())
            chars = len(text)
            self.text_stats_label.config(text=f"{words} cuvinte • {chars} caractere")

    def create_settings_section(self, parent, row):
        """Secțiunea pentru setări"""
        frame = ttk.LabelFrame(parent, text="⚙️ Setări Captions", padding=15, style='Card.TFrame')
        frame.grid(row=row, column=0, sticky="ew", pady=(0, 10))
        
        # Grid în 2 coloane pentru setări
        settings_frame = ttk.Frame(frame)
        settings_frame.grid(row=0, column=0, sticky="ew")
        settings_frame.columnconfigure(0, weight=1)
        settings_frame.columnconfigure(1, weight=1)
        
        # Left column
        left_frame = ttk.Frame(settings_frame)
        left_frame.grid(row=0, column=0, sticky="ew", padx=(0, 10))
        
        # Words per caption
        ttk.Label(left_frame, text="Cuvinte per caption:", style='Subtitle.TLabel').grid(row=0, column=0, sticky="w", pady=(0, 5))
        words_frame = ttk.Frame(left_frame)
        words_frame.grid(row=1, column=0, sticky="ew", pady=(0, 15))
        
        self.words_scale = ttk.Scale(words_frame, from_=1, to=5, variable=self.words_per_caption, orient="horizontal")
        self.words_scale.grid(row=0, column=0, sticky="ew")
        self.words_label = ttk.Label(words_frame, text="2 cuvinte")
        self.words_label.grid(row=0, column=1, padx=(10, 0))
        
        self.words_scale.configure(command=self.update_words_label)
        words_frame.columnconfigure(0, weight=1)
        
        # Min duration
        ttk.Label(left_frame, text="Durată minimă (secunde):", style='Subtitle.TLabel').grid(row=2, column=0, sticky="w", pady=(0, 5))
        self.min_duration_entry = ttk.Spinbox(left_frame, from_=0.1, to=5.0, increment=0.1, 
                                            textvariable=self.min_duration, width=10, format="%.1f")
        self.min_duration_entry.grid(row=3, column=0, sticky="w", pady=(0, 15))
        
        # Right column
        right_frame = ttk.Frame(settings_frame)
        right_frame.grid(row=0, column=1, sticky="ew")
        
        # Model selection
        ttk.Label(right_frame, text="Model Whisper:", style='Subtitle.TLabel').grid(row=0, column=0, sticky="w", pady=(0, 5))
        model_combo = ttk.Combobox(right_frame, textvariable=self.model_name, 
                                 values=["tiny", "base", "small", "medium", "large"], 
                                 state="readonly", width=15)
        model_combo.grid(row=1, column=0, sticky="w", pady=(0, 15))
        
        # Max duration
        ttk.Label(right_frame, text="Durată maximă (secunde):", style='Subtitle.TLabel').grid(row=2, column=0, sticky="w", pady=(0, 5))
        self.max_duration_entry = ttk.Spinbox(right_frame, from_=0.5, to=10.0, increment=0.1, 
                                            textvariable=self.max_duration, width=10, format="%.1f")
        self.max_duration_entry.grid(row=3, column=0, sticky="w", pady=(0, 15))
        
        # Preset buttons
        preset_frame = ttk.Frame(frame)
        preset_frame.grid(row=1, column=0, sticky="ew", pady=(10, 0))
        
        ttk.Label(preset_frame, text="🎯 Presets rapide:", style='Subtitle.TLabel').grid(row=0, column=0, columnspan=3, sticky="w", pady=(0, 5))
        
        ttk.Button(preset_frame, text="TikTok (1 cuvânt)", command=lambda: self.apply_preset("tiktok")).grid(row=1, column=0, padx=(0, 5))
        ttk.Button(preset_frame, text="YouTube Shorts (2 cuvinte)", command=lambda: self.apply_preset("youtube")).grid(row=1, column=1, padx=5)
        ttk.Button(preset_frame, text="Standard (3 cuvinte)", command=lambda: self.apply_preset("standard")).grid(row=1, column=2, padx=(5, 0))
        
        # Text formatting options
        format_frame = ttk.Frame(frame)
        format_frame.grid(row=2, column=0, sticky="ew", pady=(15, 0))
        format_frame.columnconfigure(0, weight=1)
        format_frame.columnconfigure(1, weight=1)
        
        ttk.Label(format_frame, text="🔤 Formatarea textului:", style='Subtitle.TLabel').grid(row=0, column=0, columnspan=2, sticky="w", pady=(0, 10))
        
        # Left side - punctuation
        punct_frame = ttk.Frame(format_frame)
        punct_frame.grid(row=1, column=0, sticky="w", padx=(0, 20))
        
        self.punct_cb = ttk.Checkbutton(punct_frame, text="✂️ Elimină punctuația", variable=self.remove_punctuation)
        self.punct_cb.grid(row=0, column=0, sticky="w")
        
        # Right side - text case
        case_frame = ttk.Frame(format_frame)
        case_frame.grid(row=1, column=1, sticky="w")
        
        ttk.Label(case_frame, text="Stil text:", style='Subtitle.TLabel').grid(row=0, column=0, sticky="w", pady=(0, 5))
        case_combo = ttk.Combobox(case_frame, textvariable=self.text_case,
                                values=["normal", "UPPER", "lower"], state="readonly", width=12)
        case_combo.grid(row=1, column=0, sticky="w")
        
    def create_formats_section(self, parent, row):
        """Secțiunea pentru formatele de output"""
        frame = ttk.LabelFrame(parent, text="📄 Formate Output", padding=15, style='Card.TFrame')
        frame.grid(row=row, column=0, sticky="ew", pady=(0, 10))
        
        formats_frame = ttk.Frame(frame)
        formats_frame.grid(row=0, column=0, sticky="ew")
        
        col = 0
        for format_name, var in self.output_formats.items():
            cb = ttk.Checkbutton(formats_frame, text=format_name, variable=var)
            cb.grid(row=0, column=col, sticky="w", padx=(0, 20))
            col += 1
            
    def create_output_folder_section(self, parent, row):
        """Secțiunea pentru selectarea folderului de output"""
        frame = ttk.LabelFrame(parent, text="📂 Folder de Export", padding=15, style='Card.TFrame')
        frame.grid(row=row, column=0, sticky="ew", pady=(0, 10))
        frame.columnconfigure(1, weight=1)
        
        # Current folder display
        ttk.Label(frame, text="Salvează în:", style='Subtitle.TLabel').grid(row=0, column=0, sticky="w", pady=5)
        
        self.folder_entry = ttk.Entry(frame, textvariable=self.output_folder, font=('Segoe UI', 9), state='readonly')
        self.folder_entry.grid(row=0, column=1, sticky="ew", padx=(10, 10), pady=5)
        
        folder_btn_frame = ttk.Frame(frame)
        folder_btn_frame.grid(row=0, column=2, padx=(5, 0), pady=5)
        
        ttk.Button(folder_btn_frame, text="📁 Alege Folder", command=self.browse_output_folder, 
                  style='Modern.TButton').grid(row=0, column=0, padx=(0, 5))
        
        ttk.Button(folder_btn_frame, text="📍 Folderul Curent", command=self.reset_to_current_folder, 
                  style='Modern.TButton').grid(row=0, column=1)
        
        # Info about current folder
        try:
            current_folder = os.path.basename(self.output_folder.get()) or "Root"
            info_text = f"💡 Fișierele se vor salva în: {current_folder}/"
        except:
            info_text = "💡 Fișierele se vor salva în folderul curent"
        self.folder_info_label = ttk.Label(frame, text=info_text, style='Info.TLabel')
        self.folder_info_label.grid(row=1, column=0, columnspan=3, sticky="w", pady=(5, 0))
        
    def create_buttons_section(self, parent, row):
        """Secțiunea cu butoanele de acțiune"""
        frame = ttk.Frame(parent)
        frame.grid(row=row, column=0, columnspan=2, sticky="ew", pady=(0, 10))
        frame.columnconfigure(1, weight=1)
        
        # Left side buttons
        left_buttons = ttk.Frame(frame)
        left_buttons.grid(row=0, column=0, sticky="w")

        self.generate_btn = ttk.Button(left_buttons, text="🚀 Generează Captions",
                                     command=self.generate_captions, style='Modern.TButton')
        self.generate_btn.grid(row=0, column=0, padx=(0, 5))

        self.preview_btn = ttk.Button(left_buttons, text="🔍 Previzualizare",
                                    command=self.preview_captions, style='Modern.TButton', state='disabled')
        self.preview_btn.grid(row=0, column=1, padx=5)

        # Right side buttons
        self.open_folder_btn = ttk.Button(frame, text="📁 Deschide Folder",
                                        command=self.open_output_folder, style='Modern.TButton')
        self.open_folder_btn.grid(row=0, column=2, sticky="e")
        
    def create_output_section(self, parent, row):
        """Secțiunea pentru output și progress"""
        frame = ttk.LabelFrame(parent, text="📋 Output & Progress", padding=15, style='Card.TFrame')
        frame.grid(row=row, column=0, columnspan=2, sticky="nsew", pady=(0, 0))
        frame.columnconfigure(0, weight=1)
        frame.rowconfigure(1, weight=1)
        
        # Progress bar
        self.progress = ttk.Progressbar(frame, mode='indeterminate')
        self.progress.grid(row=0, column=0, sticky="ew", pady=(0, 10))
        
        # Output text
        self.output_text = scrolledtext.ScrolledText(frame, height=12, font=('Consolas', 9))
        self.output_text.grid(row=1, column=0, sticky="nsew")
        
    def on_file_drop(self, event):
        """Handler pentru drag & drop"""
        files = self.root.tk.splitlist(event.data)
        if files:
            file_path = files[0]
            # Extind lista de formate suportate
            supported_formats = ('.mp3', '.wav', '.m4a', '.flac', '.ogg', '.aac', '.wma', '.mp4', '.avi', '.mkv', '.mov')
            if file_path.lower().endswith(supported_formats):
                self.audio_file.set(file_path)
                file_ext = os.path.splitext(file_path)[1].upper()
                
                # Optionally set output folder to same as audio file
                audio_folder = os.path.dirname(file_path)
                if audio_folder != self.output_folder.get():
                    choice = messagebox.askyesno(
                        "Folder de Export", 
                        f"Vrei să salvez captions-urile în același folder cu audio-ul?\n\n📁 {audio_folder}"
                    )
                    if choice:
                        self.output_folder.set(audio_folder)
                        folder_name = os.path.basename(audio_folder) or "Root"
                        self.folder_info_label.config(text=f"💡 Fișierele se vor salva în: {folder_name}/")
                        self.log_message(f"📂 Folder de export setat: {audio_folder}")
                
                self.log_message(f"✅ Fișier {file_ext} selectat: {os.path.basename(file_path)}")
            else:
                messagebox.showerror("Format nesuportat", 
                    "Formatul fișierului nu este suportat!\n\n" +
                    "Formatele suportate:\n" +
                    "🎵 Audio: MP3, WAV, M4A, FLAC, OGG, AAC, WMA\n" +
                    "🎬 Video: MP4, AVI, MKV, MOV (se extrage audio-ul)")
                
    def browse_file(self):
        """Deschide dialogul pentru selectarea fișierului"""
        file_path = filedialog.askopenfilename(
            title="Selectează fișierul audio",
            filetypes=[
                ("Toate formatele audio", "*.mp3 *.wav *.m4a *.flac *.ogg *.aac *.wma *.mp4 *.avi"),
                ("MP3 Audio", "*.mp3"),
                ("WAV Audio", "*.wav"),
                ("M4A Audio", "*.m4a"),
                ("FLAC Audio", "*.flac"),
                ("OGG Audio", "*.ogg"),
                ("AAC Audio", "*.aac"),
                ("Video cu audio", "*.mp4 *.avi *.mkv *.mov"),
                ("Toate fișierele", "*.*")
            ]
        )
        if file_path:
            self.audio_file.set(file_path)
            file_ext = os.path.splitext(file_path)[1].upper()
            file_type = "🎵 Audio" if file_ext in ['.MP3', '.WAV', '.M4A', '.FLAC', '.OGG', '.AAC', '.WMA'] else "🎬 Video"
            
            # Optionally set output folder to same as audio file
            audio_folder = os.path.dirname(file_path)
            if audio_folder != self.output_folder.get():
                choice = messagebox.askyesno(
                    "Folder de Export", 
                    f"Vrei să salvez captions-urile în același folder cu audio-ul?\n\n📁 {audio_folder}\n\n(Poți schimba oricând din secțiunea 'Folder de Export')"
                )
                if choice:
                    self.output_folder.set(audio_folder)
                    folder_name = os.path.basename(audio_folder) or "Root"
                    self.folder_info_label.config(text=f"💡 Fișierele se vor salva în: {folder_name}/")
                    self.log_message(f"📂 Folder de export setat: {audio_folder}")
            
            self.log_message(f"✅ Fișier {file_type} {file_ext} selectat: {os.path.basename(file_path)}")
            
    def browse_output_folder(self):
        """Deschide dialogul pentru selectarea folderului de output"""
        try:
            current_folder = self.output_folder.get()
            # Verifică dacă folderul curent există, altfel folosește directorul curent
            if not os.path.exists(current_folder):
                current_folder = os.getcwd()
                
            folder_path = filedialog.askdirectory(
                title="Selectează folderul pentru salvarea captions-urilor",
                initialdir=current_folder
            )
            if folder_path:
                # Normalizează calea
                folder_path = os.path.normpath(folder_path)
                self.output_folder.set(folder_path)
                folder_name = os.path.basename(folder_path) or "Root"
                self.folder_info_label.config(text=f"💡 Fișierele se vor salva în: {folder_name}/")
                self.log_message(f"📂 Folder de export: {folder_path}")
        except Exception as e:
            self.log_message(f"❌ Eroare la selectarea folderului: {e}")
            messagebox.showerror("Eroare", f"Nu pot deschide dialogul de selectare folder:\n{e}")
            
    def reset_to_current_folder(self):
        """Resetează folderul de output la directorul curent"""
        current_dir = os.getcwd()
        self.output_folder.set(current_dir)
        folder_name = os.path.basename(current_dir) or "Root"
        self.folder_info_label.config(text=f"💡 Fișierele se vor salva în: {folder_name}/")
        self.log_message(f"📍 Resetat la folderul curent: {current_dir}")
            
    def update_words_label(self, value):
        """Actualizez label-ul pentru numărul de cuvinte"""
        words = int(float(value))
        self.words_label.config(text=f"{words} {'cuvânt' if words == 1 else 'cuvinte'}")
        
    def apply_preset(self, preset_type):
        """Aplică preset-urile pentru diferite platforme"""
        presets = {
            "tiktok": {"words": 1, "min_dur": 0.5, "max_dur": 2.0},
            "youtube": {"words": 2, "min_dur": 0.7, "max_dur": 3.0},
            "standard": {"words": 3, "min_dur": 1.0, "max_dur": 4.0}
        }
        
        if preset_type in presets:
            preset = presets[preset_type]
            self.words_per_caption.set(preset["words"])
            self.min_duration.set(preset["min_dur"])
            self.max_duration.set(preset["max_dur"])
            self.log_message(f"📱 Preset aplicat: {preset_type.upper()}")
            
    def log_message(self, message):
        """Adaugă mesaj în zona de output"""
        self.output_text.insert(tk.END, f"{message}\n")
        self.output_text.see(tk.END)
        self.root.update_idletasks()
        
    def generate_captions(self):
        """Generează captions în thread separat"""
        if self.is_processing:
            messagebox.showwarning("Avertisment", "Generarea este deja în curs...")
            return
            
        if not self.audio_file.get():
            messagebox.showerror("Eroare", "Selectează un fișier audio sau video!")
            return
            
        if not os.path.exists(self.audio_file.get()):
            messagebox.showerror("Eroare", "Fișierul selectat nu există!")
            return
            
        # Verifică formatele selectate
        selected_formats = [fmt for fmt, var in self.output_formats.items() if var.get()]
        if not selected_formats:
            messagebox.showerror("Eroare", "Selectează cel puțin un format de output!")
            return
            
        # Start processing în thread
        self.is_processing = True
        self.generate_btn.config(state='disabled', text='⏳ Generez...')
        self.progress.start(10)
        
        thread = threading.Thread(target=self._generate_captions_worker)
        thread.daemon = True
        thread.start()
        
    def _generate_captions_worker(self):
        """Worker thread pentru generarea captions-urilor"""
        try:
            self.log_message("🚀 Încep generarea captions-urilor...")
            
            # Inițializez generatorul
            if not self.generator:
                self.generator = DynamicCaptionsGenerator(self.model_name.get())
                
            # Parametrii
            audio_path = self.audio_file.get()
            words = self.words_per_caption.get()
            min_dur = self.min_duration.get()
            max_dur = self.max_duration.get()
            remove_punct = self.remove_punctuation.get()
            text_case = self.text_case.get().lower() if self.text_case.get() != "UPPER" else "upper"

            # Obține textul original dacă este activat
            original_text = None
            if self.use_original_text.get():
                text = self.original_text_widget.get('1.0', tk.END).strip()
                if text and text != "Paste aici textul pe care l-ai folosit în ElevenLabs...":
                    original_text = text
                    self.log_message(f"📝 Folosesc textul original pentru corectare ({len(text.split())} cuvinte)")
            
            # Log parametri cu formatare
            format_info = []
            if remove_punct:
                format_info.append("fără punctuație")
            if text_case != "normal":
                format_info.append(f"text {text_case}")
            format_str = f" ({', '.join(format_info)})" if format_info else ""
            
            self.log_message(f"📝 Parametrii: {words} cuvinte/caption, {min_dur}-{max_dur}s durată{format_str}")
            
            # Generez captions
            self.log_message("🎤 Transcriu audio cu Whisper AI...")
            result = self.generator.generate_dynamic_captions(
                audio_path, words, min_dur, max_dur,
                output_dir=self.output_folder.get(),
                remove_punctuation=remove_punct,
                text_case=text_case,
                original_text=original_text
            )
            
            if not result or not result.get('captions'):
                raise Exception("Nu am putut transcrie audio-ul")

            # Extrag lista de captions din rezultat
            captions = result['captions']
            stats = result.get('stats', {})

            # Stochează pentru previzualizare
            self.last_generated_captions = captions.copy()
            self.last_original_text = original_text

            # Activează butonul de previzualizare
            self.root.after(0, lambda: self.preview_btn.config(state='normal'))
            
            # Salvez în formatele selectate în folderul ales
            base_name = Path(audio_path).stem
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            output_folder = self.output_folder.get()
            saved_files = []
            
            for fmt, var in self.output_formats.items():
                if var.get():
                    if fmt == 'SRT':
                        output_path = os.path.join(output_folder, f"{base_name}_captions_{timestamp}.srt")
                        self.generator.save_srt(captions, output_path)
                        saved_files.append(os.path.basename(output_path))
                    elif fmt == 'VTT':
                        output_path = os.path.join(output_folder, f"{base_name}_captions_{timestamp}.vtt")
                        self.generator.save_vtt(captions, output_path)
                        saved_files.append(os.path.basename(output_path))
                    elif fmt == 'JSON':
                        output_path = os.path.join(output_folder, f"{base_name}_captions_{timestamp}.json")
                        self.generator.save_json(captions, output_path)
                        saved_files.append(os.path.basename(output_path))
                    elif fmt == 'CSV':
                        output_path = os.path.join(output_folder, f"{base_name}_captions_{timestamp}.csv")
                        self.generator.save_csv(captions, output_path)
                        saved_files.append(os.path.basename(output_path))
                        
            # Statistici din rezultat sau calculate local
            total_words = stats.get('total_words', sum(len(segment['text'].split()) for segment in captions))
            total_duration = stats.get('total_duration', captions[-1]['end'] if captions else 0)
            avg_words = stats.get('avg_words_per_caption', total_words / len(captions) if captions else 0)

            self.log_message(f"✅ Succes! Generat {len(captions)} captions din {total_words} cuvinte")
            self.log_message(f"📊 Statistici: {avg_words:.1f} cuvinte/caption, {total_duration:.1f}s durată totală")

            # Afișează statistici de corectare dacă există
            if stats.get('correction_applied'):
                corrected = stats.get('corrected_words', 0)
                rate = stats.get('correction_rate', 0)
                accuracy = stats.get('accuracy_estimate', 100)
                self.log_message(f"🔧 Corectare automată: {corrected} cuvinte corectate ({rate:.1f}%)")
                self.log_message(f"🎯 Acuratețe estimată: {accuracy:.1f}%")
            self.log_message(f"💾 Fișiere salvate: {', '.join(saved_files)}")
            
            # Întreabă dacă să deschidă folderul
            self.root.after(0, self._show_completion_dialog, saved_files)
            
        except Exception as e:
            self.log_message(f"❌ Eroare: {str(e)}")
            self.root.after(0, messagebox.showerror, "Eroare", f"A apărut o eroare:\n{str(e)}")
        finally:
            # Reset UI
            self.root.after(0, self._reset_ui)
            
    def _show_completion_dialog(self, saved_files):
        """Afișează dialogul de finalizare"""
        result = messagebox.askyesno(
            "Captions Generate!", 
            f"Captions-urile au fost generate cu succes!\n\nFișiere salvate:\n{chr(10).join(['• ' + f for f in saved_files])}\n\nVrei să deschizi folderul cu fișierele?"
        )
        if result:
            self.open_output_folder()
            
    def _reset_ui(self):
        """Resetează UI-ul după procesare"""
        self.is_processing = False
        self.generate_btn.config(state='normal', text='🚀 Generează Captions')
        self.progress.stop()
        
    def preview_captions(self):
        """Deschide fereastra de previzualizare și validare"""
        if not self.last_generated_captions:
            messagebox.showwarning("Avertisment", "Nu există captions generate pentru previzualizare!")
            return

        try:
            # Creează fereastra de previzualizare
            preview = CaptionPreviewWindow(
                self.root,
                self.last_generated_captions,
                self.last_original_text
            )

            # Așteaptă să se închidă fereastra
            self.root.wait_window(preview.window)

            # Verifică dacă utilizatorul a aprobat
            if preview.approved:
                final_captions = preview.get_final_captions()
                if final_captions:
                    # Actualizează captions cu modificările
                    self.last_generated_captions = final_captions
                    self.log_message("✅ Captions aprobate! Poți continua cu exportul.")

                    # Întreabă dacă să salveze acum
                    result = messagebox.askyesno(
                        "Salvare Captions",
                        "Vrei să salvezi acum captions-urile aprobate?"
                    )
                    if result:
                        self._save_approved_captions(final_captions)
            else:
                self.log_message("❌ Previzualizare anulată. Captions nu au fost modificate.")

        except Exception as e:
            self.log_message(f"❌ Eroare la previzualizare: {e}")
            messagebox.showerror("Eroare", f"Nu pot deschide previzualizarea:\n{e}")

    def _save_approved_captions(self, captions):
        """Salvează captions aprobate în formatele selectate"""
        try:
            # Obține informațiile de bază
            audio_path = self.audio_file.get()
            base_name = Path(audio_path).stem
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            output_folder = self.output_folder.get()
            saved_files = []

            self.log_message("💾 Salvez captions aprobate...")

            # Salvează în formatele selectate
            for fmt, var in self.output_formats.items():
                if var.get():
                    if fmt == 'SRT':
                        output_path = os.path.join(output_folder, f"{base_name}_approved_{timestamp}.srt")
                        self.generator.save_srt(captions, output_path)
                        saved_files.append(os.path.basename(output_path))
                    elif fmt == 'VTT':
                        output_path = os.path.join(output_folder, f"{base_name}_approved_{timestamp}.vtt")
                        self.generator.save_vtt(captions, output_path)
                        saved_files.append(os.path.basename(output_path))
                    elif fmt == 'JSON':
                        output_path = os.path.join(output_folder, f"{base_name}_approved_{timestamp}.json")
                        self.generator.save_json(captions, output_path)
                        saved_files.append(os.path.basename(output_path))
                    elif fmt == 'CSV':
                        output_path = os.path.join(output_folder, f"{base_name}_approved_{timestamp}.csv")
                        self.generator.save_csv(captions, output_path)
                        saved_files.append(os.path.basename(output_path))

            self.log_message(f"✅ Captions aprobate salvate: {', '.join(saved_files)}")

            # Întreabă dacă să deschidă folderul
            result = messagebox.askyesno(
                "Salvare Completă!",
                f"Captions aprobate salvate cu succes!\n\nFișiere:\n{chr(10).join(['• ' + f for f in saved_files])}\n\nVrei să deschizi folderul?"
            )
            if result:
                self.open_output_folder()

        except Exception as e:
            self.log_message(f"❌ Eroare la salvarea captions: {e}")
            messagebox.showerror("Eroare", f"Nu pot salva captions-urile:\n{e}")

    def open_output_folder(self):
        """Deschide folderul cu fișierele generate"""
        try:
            folder_to_open = self.output_folder.get()
            
            # Verifică dacă folderul există
            if not os.path.exists(folder_to_open):
                self.log_message(f"❌ Folderul nu există: {folder_to_open}")
                messagebox.showerror("Eroare", f"Folderul nu există:\n{folder_to_open}")
                return
            
            success = False
            if os.name == 'nt':  # Windows
                try:
                    # Metoda 1: os.startfile (cea mai bună pentru Windows)
                    os.startfile(folder_to_open)
                    success = True
                except:
                    try:
                        # Metoda 2: explorer cu subprocess
                        subprocess.run(['explorer', os.path.normpath(folder_to_open)], 
                                     check=False, timeout=5)
                        success = True
                    except:
                        pass
            elif os.name == 'posix':  # macOS and Linux
                try:
                    if sys.platform == 'darwin':
                        subprocess.run(['open', folder_to_open], check=False, timeout=5)
                    else:
                        subprocess.run(['xdg-open', folder_to_open], check=False, timeout=5)
                    success = True
                except:
                    pass
                    
            if success:
                self.log_message(f"📁 Deschis folderul: {os.path.basename(folder_to_open)}")
            else:
                # Fallback: copiază calea în clipboard
                try:
                    self.root.clipboard_clear()
                    self.root.clipboard_append(folder_to_open)
                    self.log_message(f"📋 Calea folderului copiată în clipboard: {folder_to_open}")
                    messagebox.showinfo("Info", f"Nu pot deschide folderul automat.\nCalea a fost copiată în clipboard:\n\n{folder_to_open}")
                except:
                    self.log_message(f"💡 Deschide manual folderul: {folder_to_open}")
                    
        except Exception as e:
            self.log_message(f"❌ Eroare la deschiderea folderului: {e}")
            messagebox.showerror("Eroare", f"Nu pot deschide folderul:\n{folder_to_open}\n\nEroare: {e}")

    def load_config(self):
        """Încarcă setările salvate din config file"""
        try:
            if self.config_file.exists():
                with open(self.config_file, 'r', encoding='utf-8') as f:
                    config = json.load(f)

                # Încarcă toate setările
                if 'words_per_caption' in config:
                    self.words_per_caption.set(config['words_per_caption'])
                if 'min_duration' in config:
                    self.min_duration.set(config['min_duration'])
                if 'max_duration' in config:
                    self.max_duration.set(config['max_duration'])
                if 'model_name' in config:
                    self.model_name.set(config['model_name'])

                # Încarcă formatele de output
                if 'output_formats' in config:
                    for fmt, value in config['output_formats'].items():
                        if fmt in self.output_formats:
                            self.output_formats[fmt].set(value)

                # Încarcă opțiuni de formatare
                if 'remove_punctuation' in config:
                    self.remove_punctuation.set(config['remove_punctuation'])
                if 'text_case' in config:
                    self.text_case.set(config['text_case'])

                # Încarcă output folder
                if 'output_folder' in config:
                    folder_path = config['output_folder']
                    # Verifică dacă folderul încă există
                    if os.path.exists(folder_path):
                        self.output_folder.set(folder_path)
                    else:
                        # Fallback la folderul curent dacă cel salvat nu mai există
                        self.output_folder.set(os.getcwd())

                # Încarcă calea audio-ului (dacă încă există)
                if 'audio_file' in config:
                    audio_path = config['audio_file']
                    if os.path.exists(audio_path):
                        self.audio_file.set(audio_path)
                        self.log_message(f"🔄 Audio restaurat: {os.path.basename(audio_path)}")

                # Încarcă textul original
                if 'original_text' in config and config['original_text']:
                    # Curăță placeholder-ul
                    if self.original_text_widget.get('1.0', tk.END).strip() == "Paste aici textul pe care l-ai folosit în ElevenLabs...":
                        self.original_text_widget.delete('1.0', tk.END)
                        self.original_text_widget.config(fg='#2c3e50')

                    self.original_text_widget.insert('1.0', config['original_text'])
                    self.update_text_stats()
                    self.log_message("📝 Text original restaurat din config")

                print("✓ Config încărcat cu succes")
        except Exception as e:
            print(f"⚠️ Eroare la încărcarea config: {e}")

    def save_config(self):
        """Salvează setările curente în config file"""
        try:
            # Obține textul original (fără placeholder)
            original_text = self.original_text_widget.get('1.0', tk.END).strip()
            if original_text == "Paste aici textul pe care l-ai folosit în ElevenLabs...":
                original_text = ""

            config = {
                'words_per_caption': self.words_per_caption.get(),
                'min_duration': self.min_duration.get(),
                'max_duration': self.max_duration.get(),
                'model_name': self.model_name.get(),
                'output_formats': {
                    fmt: var.get() for fmt, var in self.output_formats.items()
                },
                'remove_punctuation': self.remove_punctuation.get(),
                'text_case': self.text_case.get(),
                'output_folder': self.output_folder.get(),
                'audio_file': self.audio_file.get(),
                'original_text': original_text
            }

            with open(self.config_file, 'w', encoding='utf-8') as f:
                json.dump(config, f, indent=2, ensure_ascii=False)

        except Exception as e:
            print(f"⚠️ Eroare la salvarea config: {e}")

    def setup_config_auto_save(self):
        """Configurez salvarea automată la schimbarea setărilor"""
        # Trace pentru variabilele principale
        self.words_per_caption.trace_add('write', lambda *args: self.save_config())
        self.min_duration.trace_add('write', lambda *args: self.save_config())
        self.max_duration.trace_add('write', lambda *args: self.save_config())
        self.model_name.trace_add('write', lambda *args: self.save_config())
        self.remove_punctuation.trace_add('write', lambda *args: self.save_config())
        self.text_case.trace_add('write', lambda *args: self.save_config())

        # Trace pentru calea audio
        self.audio_file.trace_add('write', lambda *args: self.save_config())

        # Trace pentru output folder
        self.output_folder.trace_add('write', lambda *args: self.save_config())

        # Trace pentru formatele de output
        for var in self.output_formats.values():
            var.trace_add('write', lambda *args: self.save_config())


def main():
    """Funcția principală"""
    if HAS_DND:
        try:
            root = TkinterDnD.Tk()
        except:
            root = tk.Tk()
    else:
        root = tk.Tk()
        
    app = CaptionUI(root)
    root.mainloop()


if __name__ == "__main__":
    main()