# -*- coding: utf-8 -*-
"""Dis Hekimi Saha Tarama v5 - Mardin + Kirikkale
Kaynak: Doktortakvimi son-sayfaya-kadar (K4). PRECISION + CIKTI katmani.
"""
import csv, math, os

OUTDIR = os.path.dirname(os.path.abspath(__file__))

# Merkez noktalari (kus ucusu sıralama referansi)
CENTER = {
    "Mardin":    (37.3127, 40.7340),   # Artuklu / Yenisehir merkez
    "Kirikkale": (39.8468, 33.5153),   # Kirikkale merkez
}

# Fallback (ilce-merkezine-atanmis) koordinatlar -> Konum%30, "dogrula"
FALLBACK = {
    (37.3129044, 40.7339516),               # Mardin generic
    (39.8397827, 33.5088768),               # Kirikkale generic A
    (39.8485718, 33.5276222),               # Kirikkale generic B
}

UZMAN_KW = ("ortodonti", "cene", "çene", "pedodont", "protetik", "radyoloji",
            "endodonti", "periodont", "cerrah", "restoratif")

# kayit: (ad, uzmanlik, klinik, mahalle/adres, ilce, yorum, lat, lng, public)
DATA = [
# ===================== MARDIN =====================
("Uzm. Dt. Zeynep Suzer Erdem","Ortodonti","Spident ADSP","Cumhuriyet Mah. Hastane Cd. No:11","Kiziltepe",4,37.1932755,40.5924339,False),
("Dt. Yusuf Ziya Surer","Dis hekimi","Estetik DH Y.Z. Surer","Yenisehir Mah. Kiziltepe Cad. No:5-A","Artuklu",31,37.2936478,40.7117958,False),
("Dt. Sevcan Aydin Altan","Dis hekimi","Sevcan Aydin Altan Muay.","Yeni, PTT Cd. Ozmen Sitesi B blok k2 no8","Artuklu",0,37.3208199,40.7219238,False),
("Dt. Mahmut Ozel","Dis hekimi","Ozel Daradent ADSP","Yenisehir Mah. Vali Ozan Blv. No:5 Teras2","Artuklu",22,37.329937,40.7111893,False),
("Dt. Huseyin Yildirim","Dis hekimi","Huseyin Yildirim Muay.","Kultur Cd. Karayollari Parki Arkasi No:1/3","Artuklu",21,37.3230362,40.7204475,False),
("Dt. Abdullah Emre Durgan","Dis hekimi","DH Emre Durgan","Tepebasi Mah. Kilise Cad. Ozgeze Is Hani k1","Kiziltepe",6,37.191349,40.5865974,False),
("Dt. Vedat Tari","Dis hekimi","Vedat Tari Muay.","Inonu Cad. Ramazanoglu Pasaji D:4","Artuklu",3,37.3129044,40.7339516,False),
("Dt. Zelal Yildirim Sen","Dis hekimi","Zelal Yildirim Sen Muay.","Ali Ozan Cad. Koyan Is Mrk. k3 No:11","Artuklu",0,37.3218269,40.7243271,False),
("Dt. Halis Okmen","Dis hekimi","Halis Okmen Muay.","Ozcelik Apt. k1 No:2 Yenisehir","Artuklu",1,37.3129044,40.7339516,False),
("Dt. Umit Ustuner","Dis hekimi","Alfadent Mardin","Yenisehir Mah. SSK Cad. Meric Apt. No:4/Z2","Artuklu",0,37.3199081,40.7248306,False),
("Dt. Yusuf Varisli","Dis hekimi","Yusuf Varisli Muay.","2.Cad No:11","Artuklu",0,37.3129044,40.7339516,False),
("Dt. Azize Duyan","Dis hekimi","-","Tepebasi Mah. 699A Sok. No:4/3A","Kiziltepe",0,37.1866074,40.5947342,False),
("Dt. Zuhal Yildiz","Dis hekimi","Deniz Dental","Cumhuriyet Mah. Eski Hastane Cd. No:23/A","Kiziltepe",0,37.1907272,40.5941658,False),
("Dt. Mehmet Sariboga","Dis hekimi","Deniz Dental","Cumhuriyet Mah. Eski Hastane Cd. No:23/A","Kiziltepe",0,37.1907272,40.5941658,False),
("Dt. Suat Onal","Dis hekimi","Deniz Dental","Cumhuriyet Mah. Eski Hastane Cd. No:23/A","Kiziltepe",0,37.1907272,40.5941658,False),
("Dt. Abdulkadir Duzce","Dis hekimi","Deniz Dental","Cumhuriyet Mah. Eski Hastane Cd. No:23/A","Kiziltepe",0,37.1907272,40.5941658,False),
("Dt. Abdulkerim Isiker","Dis hekimi","Abdulkerim Isiker Muay.","Kosesoy Apt. k2 No:8 (Valilik Karsisi)","Artuklu",2,37.3129044,40.7339516,False),
("Dt. Mahmut Persembe","Dis hekimi","Mahmut Persembe Muay.","Mardin merkez","Artuklu",1,37.3129044,40.7339516,False),
("Dt. Fatma Ozcelik","Dis hekimi","Fatma Ozcelik Muay.","Nusaybin","Nusaybin",0,37.0696449,41.2139969,False),
("Dt. Nezir Damar","Dis hekimi","Nezir Damar Muay.","Mardin merkez","Artuklu",0,37.3129044,40.7339516,False),
("Dt. Salih Kilic","Dis hekimi","Salih Kilic Muay.","Mardin merkez","Artuklu",0,37.3129044,40.7339516,False),
("Dt. Belman Yaman","Dis hekimi","Belman Yaman Muay.","Mardin merkez","Artuklu",0,37.3129044,40.7339516,False),
("Dt. Hakan Ipek","Dis hekimi","Hakan Ipek Muay.","Mardin merkez","Artuklu",0,37.3129044,40.7339516,False),
("Dt. Ramazan Oltan","Dis hekimi","Ramazan Oltan Muay.","Mardin merkez","Artuklu",0,37.3129044,40.7339516,False),
("Dt. Zilan Bicer","Dis hekimi","Zilan Bicer Muay.","Mardin merkez","Artuklu",0,37.3129044,40.7339516,False),
("Dt. Senem Aktoprak","Dis hekimi","-","Mardin merkez","Artuklu",0,37.3129044,40.7339516,False),
("Dt. Canan Alpergin","Dis hekimi","-","Mardin merkez","Artuklu",0,37.3129044,40.7339516,False),
("Dt. Nagihan Argin","Dis hekimi","-","Mardin merkez","Artuklu",0,37.3129044,40.7339516,False),
("Dt. Fatih Arslan","Dis hekimi","Fatih Arslan Muay.","Yenisehir Mah. SSK Cad. No:4","Artuklu",0,37.3196335,40.7245178,False),
("Dr. Dt. Esra Turk","Protetik dis tedavisi","Esra Turk Muay.","Mardin merkez","Artuklu",0,37.3239822,40.7214279,False),
("Dt. Firat Paksoylu","Dis hekimi","Firat Paksoylu Muay.","Mardin merkez","Artuklu",0,37.3129044,40.7339516,False),
("Dt. Isil Yorulmaz","Dis hekimi","Isil Yorulmaz Muay.","Mardin merkez","Artuklu",0,37.3129044,40.7339516,False),
("Dt. Selcuk Ilhan","Dis hekimi","Selcuk Ilhan Muay.","Mardin merkez","Artuklu",0,37.3129044,40.7339516,False),
("Dt. Mahmut Bulent Ozkan","Dis hekimi","Mahmut Ozkan Muay.","Yeni Mah. 94.Sok. No:2 D:3","Artuklu",0,37.3129044,40.7339516,False),
("Dt. Gokhan Ozdemir","Dis hekimi","-","Mardin merkez","Artuklu",0,37.3129044,40.7339516,False),
("Dt. Kemal Tek","Dis hekimi","Importina","Yeni Turan Mah. Mithatpasa Sok. No:7","Nusaybin",0,37.069416,41.2198753,False),
("Dt. Ferhat Karaaslan","Dis hekimi","Ferhat Karaaslan Muay.","Yeni Mah. 507. Sok. No:4/4","Kiziltepe",0,37.1907578,40.5854836,False),
("Dt. Tezcan Ozgun","Dis hekimi","Tezcan Ozgun Muay.","Mardin merkez","Artuklu",0,37.3129044,40.7339516,False),
("Dt. Mahsum Akaslan","Dis hekimi","Mahsum Akaslan Muay.","Mardin merkez","Artuklu",0,37.3129044,40.7339516,False),
("Dt. Ahmet Karatas","Dis hekimi","Ahmet Karatas Muay.","Mardin merkez","Artuklu",0,37.3129044,40.7339516,False),
("Dt. Halime Savci","Dis hekimi","Halime Savci Muay.","Mardin merkez","Artuklu",0,37.3129044,40.7339516,False),
("Dt. Ozgur Sen","Dis hekimi","Ozgur Sen Muay.","Mardin merkez","Artuklu",0,37.3129044,40.7339516,False),
("Dt. Osman Savci","Dis hekimi","Osman Savci Muay.","Mardin merkez","Artuklu",0,37.3129044,40.7339516,False),
("Dt. Seyhmus Ete","Dis hekimi","Seyhmus Ete Muay.","13 Mart Mah. Valiozan Cad. No:55","Artuklu",0,37.3307877,40.7108612,False),
("Dt. Evrim Unver","Dis hekimi","Evrim Unver Muay.","Nusaybin","Nusaybin",0,37.0781288,41.2167358,False),
("Dt. Hatice Samanci","Dis hekimi","Hatice Samanci Muay.","Urfa Cad. Akbank Yani","Artuklu",0,37.3129044,40.7339516,False),
("Dt. Nevzat Gok","Dis hekimi","Nevzat Gok Muay.","Sakarya Cad. No:37","Artuklu",0,37.3129044,40.7339516,False),
("Dt. Alime Kaya","Dis hekimi","Alime Kaya Muay.","Mardin","Artuklu",0,37.3528214,40.8053703,False),
("Dt. Bayram Kurkunc","Dis hekimi","Bayram Kurkunc Muay.","Eski Belediye Binasi k2 No:11","Artuklu",0,37.3129044,40.7339516,False),
("Dt. Hakan Gunes","Dis hekimi","Hakan Gunes Muay.","Karayollari Arkasi Kultur Cd. D Blok No:2","Artuklu",0,37.318573,40.7198486,False),
("Dt. Mehmet Dayan","Dis hekimi","Mehmet Dayan Muay.","Mardin merkez","Artuklu",0,37.3129044,40.7339516,False),
("Dt. Fatma Bilgic","Dis hekimi","Fatma Bilgic Muay.","Mardin merkez","Artuklu",0,37.3129044,40.7339516,False),
("Dt. Eliza Agaoglu","Dis hekimi","Eliza Agaoglu Muay.","Mardin merkez","Artuklu",0,37.3129044,40.7339516,False),
("Dt. Bilgehan Arpag","Dis hekimi","Bilgehan Arpag Muay.","Yunus Emre Mah. Cumhuriyet Blv. No:8","Midyat",0,37.4174881,41.360054,False),
("Dt. Murat Cecen","Dis hekimi","Murat Cecen Muay.","Yenisehir Mah. Ravza Cad. No:4-M","Artuklu",0,37.3213806,40.719101,False),
("Dt. Gurbet Mutlu","Dis hekimi","DH Gurbet Mutlu","Kiziltepe","Kiziltepe",0,37.1931114,40.5870361,False),
("Dt. Ali Emer","Dis hekimi","Ali Emer Muay.","Kiziltepe","Kiziltepe",0,37.1931114,40.5870361,False),
("Dt. Onur Budak","Dis hekimi","Onur Budak Muay.","Mardin merkez","Artuklu",0,37.3129044,40.7339516,False),
("Dt. Hasan Ertas","Dis hekimi","Hasan Ertas Muay.","Mardin merkez","Artuklu",0,37.3129044,40.7339516,False),
("Dt. Halit Guzcan","Dis hekimi","Halit Guzcan Muay.","Mardin merkez","Artuklu",0,37.3129044,40.7339516,False),
("Dt. Mehmet Helvacier","Dis hekimi","Mehmet Helvacier Muay.","13 Mart Mah. Dabakoglu Apt. A-Blok k1 No:2","Artuklu",0,37.3129044,40.7339516,False),
# --- Mardin KAMU ---
("Dt. Serpil Demir","Dis hekimi","Nusaybin Devlet Hastanesi","Abdulkadirpasa Mah.","Nusaybin",1,37.0812988,41.2206459,True),
("Dt. Mehmet Esen","Dis hekimi","Kiziltepe ADSM","Tepebasi Mah. Hastane Cad.","Kiziltepe",0,37.3211632,40.7244759,True),
("Dt. Gulsen Yurekli","Dis hekimi","Mardin ADSM","Savurkapi Mah.","Artuklu",0,37.3177147,40.7504425,True),
("Dt. Mehmet Nuri Azboy","Dis hekimi","Mardin ADSM","Savurkapi Mah.","Artuklu",0,37.3177147,40.7504425,True),
("Dt. Mehmet Sidik Orak","Dis hekimi","Mardin ADSM","Savurkapi Mah.","Artuklu",0,37.3177147,40.7504425,True),
("Dt. Mehmet Vahit Yildiz","Dis hekimi","Mardin Omerli Ilce Hastanesi","Yeni Mah. Ilce Girisi","Omerli",0,37.4033813,40.9521332,True),
# ===================== KIRIKKALE =====================
("Dt. Cemalettin Ozdemir","Dis hekimi","Cemalettin Ozdemir Dis Klinigi","Yeni Dogan Mah. Zafer Cad. Bastas Is Hani No:40 k2","Merkez",2,39.8421097,33.5058632,False),
("Dt. Hasan Tezel","Dis hekimi","Ozel Alfadent ADSP","Gurler Mah. A.Turkes Blv. No:212/A","Merkez",0,39.8466988,33.5159721,False),
("Dt. Tacettin Silsupur","Dis hekimi","Tacettin Silsupur Muay.","Zafer Cad. Yenigun Kirtasiye Ustu k3","Merkez",1,39.8451004,33.5053406,False),
("Dt. Baris Kandehir","Dis hekimi","Kirikkale Uni. Dis Hek. Fak.","Yenidogan Mah. Mimar Sinan Cad. No:25","Merkez",0,39.8410645,33.5063438,True),
("Dt. Esma Nur Keles","Dis hekimi","Esma Nur Keles Muay.","Yenidogan Mah. 608. Sokak","Merkez",4,39.8421097,33.5061951,False),
("Dt. Oguzhan Lacin","Dis hekimi","Oguzhan Lacin Muay.","Ovacik Mah. Hurriyet Cad.","Merkez",0,39.844162,33.5036774,False),
("Dt. Hasim Korkut","Dis hekimi","Hasim Korkut Muay.","Yenidogan Mah. Cumhuriyet Cad. No:34/2","Merkez",0,39.8409653,33.5060577,False),
("Dt. Rafet Ulusoy","Dis hekimi","Rafet Ulusoy Muay.","Kirikkale merkez","Merkez",0,39.8397827,33.5088768,False),
("Dt. Engin Cebecioglu","Dis hekimi","Engin Cebecioglu Muay.","Yaylacik Mh. Ankara Cd.","Merkez",0,39.8485718,33.5276222,False),
("Dt. Tuna Cavbin","Dis hekimi","Tuna Cavbin Muay.","Huseyin Kahya Mah. Menderes Cad. No:1/1","Merkez",0,39.8485718,33.5276222,False),
("Dt. Merve Eyupoglu Ur","Dis hekimi","Merve Eyupoglu Ur Muay.","Fabrikalar Mah. Saglik Cad. No:5/E","Merkez",1,39.8485718,33.5276222,False),
("Dt. Seda Nur Bozkurt","Dis hekimi","Ozel Alfadent ADSP","Gurler Mah. A.Turkes Blv. No:212/A","Merkez",0,39.8466988,33.5159721,False),
("Dt. Ramin Eyyub","Dis hekimi","Ozel Alfadent ADSP","Gurler Mah. A.Turkes Blv. No:212/A","Merkez",0,39.8466988,33.5159721,False),
("Dt. Kemal Karacol","Dis hekimi","Ozel Alfadent ADSP","Gurler Mah. A.Turkes Blv. No:212/A","Merkez",0,39.8466988,33.5159721,False),
("Dt. Aysegul Hazir","Dis hekimi","Ozel Alfadent ADSP","Gurler Mah. A.Turkes Blv. No:212/A","Merkez",0,39.8466988,33.5159721,False),
("Dt. Yusuf Islam Gunes","Dis hekimi","Ozel Alfadent ADSP","Gurler Mah. A.Turkes Blv. No:212/A","Merkez",0,39.8466988,33.5159721,False),
("Dt. Mustafa Kaan Karabudak","Dis hekimi","Mustafa Kaan Karabudak Muay.","Kirikkale merkez","Merkez",0,39.8397827,33.5088768,False),
("Dt. Assozum Dasdemir","Dis hekimi","-","Kirikkale merkez","Merkez",0,39.8397827,33.5088768,False),
("Dt. Rabia Saylan","Dis hekimi","Rabia Saylan Muay.","Ovacik Mah. Ankara Cad. No:18/2","Merkez",0,39.844162,33.5036774,False),
("Dt. Irem Geceroglu","Dis hekimi","Irem Geceroglu Muay.","Kirikkale merkez","Merkez",0,39.8485718,33.5276222,False),
("Dt. Zeynep Ozbayrak","Dis hekimi","Zeynep Ozbayrak Muay.","Yenidogan Mah. 609. Sok. No:5/3","Merkez",0,39.8424835,33.5061951,False),
("Dt. Merve Oncel","Dis hekimi","Merve Oncel Muay.","Kirikkale merkez","Merkez",0,39.8485718,33.5276222,False),
("Dt. Fatma Kahveci","Dis hekimi","Fatma Kahveci Muay.","Kirikkale merkez","Merkez",0,39.8485718,33.5276222,False),
("Dt. Nushet Dogan","Dis hekimi","Nushet Dogan Muay.","Kirikkale merkez","Merkez",0,39.8485718,33.5276222,False),
("Dt. Ismet Cetin","Dis hekimi","Ismet Cetin Muay.","Kirikkale merkez","Merkez",0,39.8485718,33.5276222,False),
("Dt. Yunus Kalkan","Dis hekimi","Yunus Kalkan Muay.","Zafer Cad. Ulusoy Ishani No:42/106","Merkez",0,39.8451004,33.5053406,False),
("Dt. Orhan Baysal","Dis hekimi","Orhan Baysal Muay.","Ovacik Mah. 5 Sok. 8/2","Merkez",0,39.8421097,33.5092545,False),
("Dt. Orhan Uyar","Dis hekimi","Orhan Uyar Muay.","Ovacik Mah. Ankara Cad. No:21","Merkez",0,39.8397827,33.5088768,False),
("Dt. Zeki Guryil","Dis hekimi","Zeki Guryil Muay.","Cumhuriyet Cad. No:3 k1","Merkez",0,39.8412247,33.5060501,False),
("Dt. Davut Cihangir","Dis hekimi","Davut Cihangir Muay.","Kirikkale merkez","Merkez",0,39.8397827,33.5088768,False),
("Dt. Engin Aktas","Dis hekimi","Engin Aktas Muay.","Kirikkale merkez","Merkez",0,39.8397827,33.5088768,False),
("Dt. Murat Ozturk","Dis hekimi","Murat Ozturk Muay.","Yenidogan Mah. Cumhuriyet Cad. No:34/2","Merkez",2,39.8409653,33.5060577,False),
# --- Kirikkale KAMU ---
("Dt. Onder Bayram","Dis hekimi","Kirikkale Devlet Hastanesi","Yeni Mah. Saglik Cad.","Merkez",2,39.8107872,33.4752312,True),
("Dt. Feyza Uyanik","Dis hekimi","Kirikkale Uni. Dis Hek. Fak.","Yenidogan Mah. Mimar Sinan Cad. No:25","Merkez",1,39.8410645,33.5063438,True),
("Uzm. Dr. Isil Yildirim Bildik","Restoratif dis tedavisi","Kirikkale Uni. Dis Hek. Fak.","Yenidogan Mah. Mimar Sinan Cad. No:25","Merkez",0,39.8410645,33.5063438,True),
("Dr. Dt. Gulden Uzgoren","Ortodonti","Kirikkale Uni. Dis Hek. Fak.","Yenidogan Mah. Mimar Sinan Cad. No:25","Merkez",0,39.8410645,33.5063438,True),
("Uzm. Dr. Ali Can Bulut","Protetik dis tedavisi","Kirikkale Uni. Dis Hek. Fak.","Yenidogan Mah. Mimar Sinan Cad. No:25","Merkez",0,39.8410645,33.5063438,True),
("Dt. Damla Dogan","Dis hekimi","Kirikkale Uni. Dis Hek. Fak.","Yenidogan Mah. Mimar Sinan Cad. No:25","Merkez",0,39.8410645,33.5063438,True),
("Uzm. Dr. Selmi Yilmaz","Agiz dis cene radyolojisi","Kirikkale Uni. Dis Hek. Fak.","Yenidogan Mah. Mimar Sinan Cad. No:25","Merkez",0,39.8410645,33.5063438,True),
("Uzm. Dr. Mehmet Zahit Adisen","Agiz dis cene radyolojisi","Kirikkale Uni. Dis Hek. Fak.","Yenidogan Mah. Mimar Sinan Cad. No:25","Merkez",0,39.8410645,33.5063438,True),
("Dt. Berna Arfat","Dis hekimi","Kirikkale Uni. Dis Hek. Fak.","Yenidogan Mah. Mimar Sinan Cad. No:25","Merkez",0,39.8410645,33.5063438,True),
("Dt. Hasan Murat Toredi","Dis hekimi","Kirikkale ADSM","Millet Cad.","Merkez",0,39.8107872,33.4752312,True),
]

def il_of(ilce):
    return "Mardin" if ilce in ("Artuklu","Kiziltepe","Nusaybin","Midyat","Omerli") else "Kirikkale"

def haversine(a, b):
    R=6371.0
    la1,lo1=math.radians(a[0]),math.radians(a[1])
    la2,lo2=math.radians(b[0]),math.radians(b[1])
    d=math.sin((la2-la1)/2)**2+math.cos(la1)*math.cos(la2)*math.sin((lo2-lo1)/2)**2
    return R*2*math.asin(math.sqrt(d))

def color(rev, uzman):
    if rev>=150: return "TURUNCU MEGA"
    if rev>=50:  return "SARI HOT"
    if uzman:    return "MAVI UZMAN"
    return "BEYAZ standart"

def build(rows, public):
    out=[]
    for r in rows:
        ad,uzm,klinik,adres,ilce,yorum,lat,lng,pub=r
        if pub!=public: continue
        il=il_of(ilce)
        is_fb=(round(lat,7),round(lng,7)) in FALLBACK
        konum = 30 if is_fb else 100
        varlik = 60  # tek kaynak (dt) - "Google'da yok" varsay
        uzman = any(k in uzm.lower() for k in UZMAN_KW)
        dist = round(haversine(CENTER[il],(lat,lng)),2)
        out.append({
            "il":il,"ilce":ilce,"ad":ad,"klinik":klinik,"uzmanlik":uzm,
            "adres":adres,"yorum":yorum,"lat":lat,"lng":lng,
            "uzaklik_km":dist,"renk":color(yorum,uzman),
            "varlik":varlik,"konum":konum,
            "not":"Konum: ilce-merkezine atanmis, DOGRULA" if is_fb else "",
            "kaynak":"dt"
        })
    out.sort(key=lambda x:(x["il"],x["uzaklik_km"]))
    return out

# dedup: ayni ad -> tekille
seen=set(); ded=[]
for r in DATA:
    key=r[0].lower().replace(" ","")
    if key in seen: continue
    seen.add(key); ded.append(r)

ozel = build(ded, False)
kamu = build(ded, True)

# ---- CSV yaz ----
cols=["il","ilce","uzaklik_km","ad","klinik","uzmanlik","adres","yorum","renk","varlik","konum","kaynak","lat","lng","not"]
def wcsv(fn, rows):
    p=os.path.join(OUTDIR,fn)
    with open(p,"w",newline="",encoding="utf-8-sig") as f:
        w=csv.DictWriter(f,fieldnames=cols); w.writeheader()
        for x in rows: w.writerow({c:x[c] for c in cols})
    return p

for il in ("Mardin","Kirikkale"):
    wcsv(f"{il}_ozel_klinikler.csv",[r for r in ozel if r["il"]==il])
    wcsv(f"{il}_kamu_adsm.csv",[r for r in kamu if r["il"]==il])

# ---- ozet ----
print("=== TARAMA OZETI v5 ===")
for il in ("Mardin","Kirikkale"):
    o=[r for r in ozel if r["il"]==il]; k=[r for r in kamu if r["il"]==il]
    fb=sum(1 for r in o if r["konum"]==30)
    print(f"\n[{il}]  ozel={len(o)}  kamu={len(k)}  toplam={len(o)+len(k)}")
    print(f"  konum<50 (merkeze atanmis, dogrula): {fb}/{len(o)} = %{round(100*fb/len(o))}")
    print(f"  ilce dagilimi: ", end="")
    ds={}
    for r in o: ds[r["ilce"]]=ds.get(r["ilce"],0)+1
    print(", ".join(f"{i}:{n}" for i,n in sorted(ds.items())))
print(f"\nCSV cikti klasoru: {OUTDIR}")
print("Dedup ile elenen mukerrer:",len(DATA)-len(ded))
