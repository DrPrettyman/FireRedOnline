// gBattleScriptingCommandsTable (battle_script_commands.c), in command-byte order.

import {
  Cmd_attackcanceler,
  Cmd_accuracycheck,
  Cmd_attackstring,
  Cmd_ppreduce,
  Cmd_critcalc,
  Cmd_damagecalc,
  Cmd_typecalc,
  Cmd_adjustnormaldamage,
  Cmd_adjustnormaldamage2,
  Cmd_attackanimation,
  Cmd_waitanimation,
  Cmd_healthbarupdate,
  Cmd_datahpupdate,
  Cmd_critmessage,
  Cmd_effectivenesssound,
  Cmd_resultmessage,
  Cmd_printstring,
  Cmd_printselectionstring,
  Cmd_waitmessage,
  Cmd_printfromtable,
  Cmd_printselectionstringfromtable,
  Cmd_seteffectwithchance,
  Cmd_seteffectprimary,
  Cmd_seteffectsecondary,
  Cmd_clearstatusfromeffect,
  Cmd_tryfaintmon,
  Cmd_dofaintanimation,
  Cmd_cleareffectsonfaint,
  Cmd_jumpifstatus,
  Cmd_jumpifstatus2,
  Cmd_jumpifability,
  Cmd_jumpifsideaffecting,
  Cmd_jumpifstat,
  Cmd_jumpifstatus3condition,
  Cmd_jumpiftype,
  Cmd_jumpifaffectedbyprotect,
} from './bsCommands1';
import {
  Cmd_getexp,
  Cmd_checkteamslost,
  Cmd_movevaluescleanup,
  Cmd_setmultihit,
  Cmd_decrementmultihit,
  Cmd_goto,
  Cmd_jumpifbyte,
  Cmd_jumpifhalfword,
  Cmd_jumpifword,
  Cmd_jumpifarrayequal,
  Cmd_jumpifarraynotequal,
  Cmd_setbyte,
  Cmd_addbyte,
  Cmd_subbyte,
  Cmd_copyarray,
  Cmd_copyarraywithindex,
  Cmd_orbyte,
  Cmd_orhalfword,
  Cmd_orword,
  Cmd_bicbyte,
  Cmd_bichalfword,
  Cmd_bicword,
  Cmd_pause,
  Cmd_waitstate,
  Cmd_healthbar_update,
  Cmd_return,
  Cmd_end,
  Cmd_end2,
  Cmd_end3,
  Cmd_call,
  Cmd_jumpiftype2,
  Cmd_jumpifabilitypresent,
  Cmd_endselectionscript,
  Cmd_playanimation,
  Cmd_playanimation_var,
  Cmd_setgraphicalstatchangevalues,
  Cmd_playstatchangeanimation,
  Cmd_moveend,
  Cmd_typecalc2,
  Cmd_returnatktoball,
  Cmd_getswitchedmondata,
  Cmd_switchindataupdate,
  Cmd_switchinanim,
  Cmd_jumpifcantswitch,
  Cmd_openpartyscreen,
  Cmd_switchhandleorder,
  Cmd_switchineffects,
  Cmd_trainerslidein,
  Cmd_playse,
  Cmd_fanfare,
  Cmd_playfaintcry,
  Cmd_endlinkbattle,
  Cmd_returntoball,
} from './bsCommands2';
import {
  Cmd_handlelearnnewmove,
  Cmd_yesnoboxlearnmove,
  Cmd_yesnoboxstoplearningmove,
  Cmd_hitanimation,
  Cmd_getmoneyreward,
  Cmd_updatebattlermoves,
  Cmd_swapattackerwithtarget,
  Cmd_incrementgamestat,
  Cmd_drawpartystatussummary,
  Cmd_hidepartystatussummary,
  Cmd_jumptocalledmove,
  Cmd_statusanimation,
  Cmd_status2animation,
  Cmd_chosenstatusanimation,
  Cmd_yesnobox,
  Cmd_cancelallactions,
  Cmd_adjustsetdamage,
  Cmd_removeitem,
  Cmd_atknameinbuff1,
  Cmd_drawlvlupbox,
  Cmd_resetsentmonsvalue,
  Cmd_setatktoplayer0,
  Cmd_makevisible,
  Cmd_recordlastability,
  Cmd_buffermovetolearn,
  Cmd_jumpifplayerran,
  Cmd_hpthresholds,
  Cmd_hpthresholds2,
  Cmd_useitemonopponent,
  Cmd_various,
  Cmd_setprotectlike,
  Cmd_tryexplosion,
  Cmd_setatkhptozero,
  Cmd_jumpifnexttargetvalid,
  Cmd_tryhealhalfhealth,
  Cmd_trymirrormove,
  Cmd_setrain,
  Cmd_setreflect,
  Cmd_setseeded,
  Cmd_manipulatedamage,
  Cmd_trysetrest,
  Cmd_jumpifnotfirstturn,
  Cmd_nop,
  Cmd_jumpifcantmakeasleep,
  Cmd_stockpile,
  Cmd_stockpiletobasedamage,
  Cmd_stockpiletohpheal,
  Cmd_negativedamage,
  Cmd_statbuffchange,
  Cmd_normalisebuffs,
  Cmd_setbide,
  Cmd_confuseifrepeatingattackends,
  Cmd_setmultihitcounter,
  Cmd_initmultihitstring,
  Cmd_forcerandomswitch,
  Cmd_tryconversiontypechange,
  Cmd_givepaydaymoney,
  Cmd_setlightscreen,
  Cmd_tryKO,
  Cmd_damagetohalftargethp,
  Cmd_setsandstorm,
  Cmd_weatherdamage,
  Cmd_tryinfatuating,
  Cmd_updatestatusicon,
  Cmd_setmist,
  Cmd_setfocusenergy,
  Cmd_transformdataexecution,
  Cmd_setsubstitute,
  Cmd_mimicattackcopy,
  Cmd_metronome,
  Cmd_dmgtolevel,
  Cmd_psywavedamageeffect,
  Cmd_counterdamagecalculator,
  Cmd_mirrorcoatdamagecalculator,
  Cmd_disablelastusedattack,
  Cmd_trysetencore,
  Cmd_painsplitdmgcalc,
  Cmd_settypetorandomresistance,
  Cmd_setalwayshitflag,
  Cmd_copymovepermanently,
} from './bsCommands3';
import {
  Cmd_trychoosesleeptalkmove,
  Cmd_setdestinybond,
  Cmd_trysetdestinybondtohappen,
  Cmd_remaininghptopower,
  Cmd_tryspiteppreduce,
  Cmd_healpartystatus,
  Cmd_cursetarget,
  Cmd_trysetspikes,
  Cmd_setforesight,
  Cmd_trysetperishsong,
  Cmd_rolloutdamagecalculation,
  Cmd_jumpifconfusedandstatmaxed,
  Cmd_furycuttercalc,
  Cmd_friendshiptodamagecalculation,
  Cmd_presentdamagecalculation,
  Cmd_setsafeguard,
  Cmd_magnitudedamagecalculation,
  Cmd_jumpifnopursuitswitchdmg,
  Cmd_setsunny,
  Cmd_maxattackhalvehp,
  Cmd_copyfoestats,
  Cmd_rapidspinfree,
  Cmd_setdefensecurlbit,
  Cmd_recoverbasedonsunlight,
  Cmd_hiddenpowercalc,
  Cmd_selectfirstvalidtarget,
  Cmd_trysetfutureattack,
  Cmd_trydobeatup,
  Cmd_setsemiinvulnerablebit,
  Cmd_clearsemiinvulnerablebit,
  Cmd_setminimize,
  Cmd_sethail,
  Cmd_trymemento,
  Cmd_setforcedtarget,
  Cmd_setcharge,
  Cmd_callterrainattack,
  Cmd_cureifburnedparalysedorpoisoned,
  Cmd_settorment,
  Cmd_jumpifnodamage,
  Cmd_settaunt,
  Cmd_trysethelpinghand,
  Cmd_tryswapitems,
  Cmd_trycopyability,
  Cmd_trywish,
  Cmd_trysetroots,
  Cmd_doubledamagedealtifdamaged,
  Cmd_setyawn,
  Cmd_setdamagetohealthdifference,
  Cmd_scaledamagebyhealthratio,
  Cmd_tryswapabilities,
  Cmd_tryimprison,
  Cmd_trysetgrudge,
  Cmd_weightdamagecalculation,
  Cmd_assistattackselect,
  Cmd_trysetmagiccoat,
  Cmd_trysetsnatch,
  Cmd_trygetintimidatetarget,
  Cmd_switchoutabilities,
  Cmd_jumpifhasnohp,
  Cmd_getsecretpowereffect,
  Cmd_pickup,
  Cmd_docastformchangeanimation,
  Cmd_trycastformdatachange,
  Cmd_settypebasedhalvers,
  Cmd_setweatherballtype,
  Cmd_tryrecycleitem,
  Cmd_settypetoterrain,
  Cmd_pursuitdoubles,
  Cmd_snatchsetbattlers,
  Cmd_removelightscreenreflect,
  Cmd_handleballthrow,
  Cmd_givecaughtmon,
  Cmd_trysetcaughtmondexflags,
  Cmd_displaydexinfo,
  Cmd_trygivecaughtmonnick,
  Cmd_subattackerhpbydmg,
  Cmd_removeattackerstatus1,
  Cmd_finishaction,
  Cmd_finishturn,
} from './bsCommands4';

export const gBattleScriptingCommandsTable: (() => void)[] = [
  Cmd_attackcanceler, // 0x0
  Cmd_accuracycheck, // 0x1
  Cmd_attackstring, // 0x2
  Cmd_ppreduce, // 0x3
  Cmd_critcalc, // 0x4
  Cmd_damagecalc, // 0x5
  Cmd_typecalc, // 0x6
  Cmd_adjustnormaldamage, // 0x7
  Cmd_adjustnormaldamage2, // 0x8
  Cmd_attackanimation, // 0x9
  Cmd_waitanimation, // 0xA
  Cmd_healthbarupdate, // 0xB
  Cmd_datahpupdate, // 0xC
  Cmd_critmessage, // 0xD
  Cmd_effectivenesssound, // 0xE
  Cmd_resultmessage, // 0xF
  Cmd_printstring, // 0x10
  Cmd_printselectionstring, // 0x11
  Cmd_waitmessage, // 0x12
  Cmd_printfromtable, // 0x13
  Cmd_printselectionstringfromtable, // 0x14
  Cmd_seteffectwithchance, // 0x15
  Cmd_seteffectprimary, // 0x16
  Cmd_seteffectsecondary, // 0x17
  Cmd_clearstatusfromeffect, // 0x18
  Cmd_tryfaintmon, // 0x19
  Cmd_dofaintanimation, // 0x1A
  Cmd_cleareffectsonfaint, // 0x1B
  Cmd_jumpifstatus, // 0x1C
  Cmd_jumpifstatus2, // 0x1D
  Cmd_jumpifability, // 0x1E
  Cmd_jumpifsideaffecting, // 0x1F
  Cmd_jumpifstat, // 0x20
  Cmd_jumpifstatus3condition, // 0x21
  Cmd_jumpiftype, // 0x22
  Cmd_getexp, // 0x23
  Cmd_checkteamslost, // 0x24
  Cmd_movevaluescleanup, // 0x25
  Cmd_setmultihit, // 0x26
  Cmd_decrementmultihit, // 0x27
  Cmd_goto, // 0x28
  Cmd_jumpifbyte, // 0x29
  Cmd_jumpifhalfword, // 0x2A
  Cmd_jumpifword, // 0x2B
  Cmd_jumpifarrayequal, // 0x2C
  Cmd_jumpifarraynotequal, // 0x2D
  Cmd_setbyte, // 0x2E
  Cmd_addbyte, // 0x2F
  Cmd_subbyte, // 0x30
  Cmd_copyarray, // 0x31
  Cmd_copyarraywithindex, // 0x32
  Cmd_orbyte, // 0x33
  Cmd_orhalfword, // 0x34
  Cmd_orword, // 0x35
  Cmd_bicbyte, // 0x36
  Cmd_bichalfword, // 0x37
  Cmd_bicword, // 0x38
  Cmd_pause, // 0x39
  Cmd_waitstate, // 0x3A
  Cmd_healthbar_update, // 0x3B
  Cmd_return, // 0x3C
  Cmd_end, // 0x3D
  Cmd_end2, // 0x3E
  Cmd_end3, // 0x3F
  Cmd_jumpifaffectedbyprotect, // 0x40
  Cmd_call, // 0x41
  Cmd_jumpiftype2, // 0x42
  Cmd_jumpifabilitypresent, // 0x43
  Cmd_endselectionscript, // 0x44
  Cmd_playanimation, // 0x45
  Cmd_playanimation_var, // 0x46
  Cmd_setgraphicalstatchangevalues, // 0x47
  Cmd_playstatchangeanimation, // 0x48
  Cmd_moveend, // 0x49
  Cmd_typecalc2, // 0x4A
  Cmd_returnatktoball, // 0x4B
  Cmd_getswitchedmondata, // 0x4C
  Cmd_switchindataupdate, // 0x4D
  Cmd_switchinanim, // 0x4E
  Cmd_jumpifcantswitch, // 0x4F
  Cmd_openpartyscreen, // 0x50
  Cmd_switchhandleorder, // 0x51
  Cmd_switchineffects, // 0x52
  Cmd_trainerslidein, // 0x53
  Cmd_playse, // 0x54
  Cmd_fanfare, // 0x55
  Cmd_playfaintcry, // 0x56
  Cmd_endlinkbattle, // 0x57
  Cmd_returntoball, // 0x58
  Cmd_handlelearnnewmove, // 0x59
  Cmd_yesnoboxlearnmove, // 0x5A
  Cmd_yesnoboxstoplearningmove, // 0x5B
  Cmd_hitanimation, // 0x5C
  Cmd_getmoneyreward, // 0x5D
  Cmd_updatebattlermoves, // 0x5E
  Cmd_swapattackerwithtarget, // 0x5F
  Cmd_incrementgamestat, // 0x60
  Cmd_drawpartystatussummary, // 0x61
  Cmd_hidepartystatussummary, // 0x62
  Cmd_jumptocalledmove, // 0x63
  Cmd_statusanimation, // 0x64
  Cmd_status2animation, // 0x65
  Cmd_chosenstatusanimation, // 0x66
  Cmd_yesnobox, // 0x67
  Cmd_cancelallactions, // 0x68
  Cmd_adjustsetdamage, // 0x69
  Cmd_removeitem, // 0x6A
  Cmd_atknameinbuff1, // 0x6B
  Cmd_drawlvlupbox, // 0x6C
  Cmd_resetsentmonsvalue, // 0x6D
  Cmd_setatktoplayer0, // 0x6E
  Cmd_makevisible, // 0x6F
  Cmd_recordlastability, // 0x70
  Cmd_buffermovetolearn, // 0x71
  Cmd_jumpifplayerran, // 0x72
  Cmd_hpthresholds, // 0x73
  Cmd_hpthresholds2, // 0x74
  Cmd_useitemonopponent, // 0x75
  Cmd_various, // 0x76
  Cmd_setprotectlike, // 0x77
  Cmd_tryexplosion, // 0x78
  Cmd_setatkhptozero, // 0x79
  Cmd_jumpifnexttargetvalid, // 0x7A
  Cmd_tryhealhalfhealth, // 0x7B
  Cmd_trymirrormove, // 0x7C
  Cmd_setrain, // 0x7D
  Cmd_setreflect, // 0x7E
  Cmd_setseeded, // 0x7F
  Cmd_manipulatedamage, // 0x80
  Cmd_trysetrest, // 0x81
  Cmd_jumpifnotfirstturn, // 0x82
  Cmd_nop, // 0x83
  Cmd_jumpifcantmakeasleep, // 0x84
  Cmd_stockpile, // 0x85
  Cmd_stockpiletobasedamage, // 0x86
  Cmd_stockpiletohpheal, // 0x87
  Cmd_negativedamage, // 0x88
  Cmd_statbuffchange, // 0x89
  Cmd_normalisebuffs, // 0x8A
  Cmd_setbide, // 0x8B
  Cmd_confuseifrepeatingattackends, // 0x8C
  Cmd_setmultihitcounter, // 0x8D
  Cmd_initmultihitstring, // 0x8E
  Cmd_forcerandomswitch, // 0x8F
  Cmd_tryconversiontypechange, // 0x90
  Cmd_givepaydaymoney, // 0x91
  Cmd_setlightscreen, // 0x92
  Cmd_tryKO, // 0x93
  Cmd_damagetohalftargethp, // 0x94
  Cmd_setsandstorm, // 0x95
  Cmd_weatherdamage, // 0x96
  Cmd_tryinfatuating, // 0x97
  Cmd_updatestatusicon, // 0x98
  Cmd_setmist, // 0x99
  Cmd_setfocusenergy, // 0x9A
  Cmd_transformdataexecution, // 0x9B
  Cmd_setsubstitute, // 0x9C
  Cmd_mimicattackcopy, // 0x9D
  Cmd_metronome, // 0x9E
  Cmd_dmgtolevel, // 0x9F
  Cmd_psywavedamageeffect, // 0xA0
  Cmd_counterdamagecalculator, // 0xA1
  Cmd_mirrorcoatdamagecalculator, // 0xA2
  Cmd_disablelastusedattack, // 0xA3
  Cmd_trysetencore, // 0xA4
  Cmd_painsplitdmgcalc, // 0xA5
  Cmd_settypetorandomresistance, // 0xA6
  Cmd_setalwayshitflag, // 0xA7
  Cmd_copymovepermanently, // 0xA8
  Cmd_trychoosesleeptalkmove, // 0xA9
  Cmd_setdestinybond, // 0xAA
  Cmd_trysetdestinybondtohappen, // 0xAB
  Cmd_remaininghptopower, // 0xAC
  Cmd_tryspiteppreduce, // 0xAD
  Cmd_healpartystatus, // 0xAE
  Cmd_cursetarget, // 0xAF
  Cmd_trysetspikes, // 0xB0
  Cmd_setforesight, // 0xB1
  Cmd_trysetperishsong, // 0xB2
  Cmd_rolloutdamagecalculation, // 0xB3
  Cmd_jumpifconfusedandstatmaxed, // 0xB4
  Cmd_furycuttercalc, // 0xB5
  Cmd_friendshiptodamagecalculation, // 0xB6
  Cmd_presentdamagecalculation, // 0xB7
  Cmd_setsafeguard, // 0xB8
  Cmd_magnitudedamagecalculation, // 0xB9
  Cmd_jumpifnopursuitswitchdmg, // 0xBA
  Cmd_setsunny, // 0xBB
  Cmd_maxattackhalvehp, // 0xBC
  Cmd_copyfoestats, // 0xBD
  Cmd_rapidspinfree, // 0xBE
  Cmd_setdefensecurlbit, // 0xBF
  Cmd_recoverbasedonsunlight, // 0xC0
  Cmd_hiddenpowercalc, // 0xC1
  Cmd_selectfirstvalidtarget, // 0xC2
  Cmd_trysetfutureattack, // 0xC3
  Cmd_trydobeatup, // 0xC4
  Cmd_setsemiinvulnerablebit, // 0xC5
  Cmd_clearsemiinvulnerablebit, // 0xC6
  Cmd_setminimize, // 0xC7
  Cmd_sethail, // 0xC8
  Cmd_trymemento, // 0xC9
  Cmd_setforcedtarget, // 0xCA
  Cmd_setcharge, // 0xCB
  Cmd_callterrainattack, // 0xCC
  Cmd_cureifburnedparalysedorpoisoned, // 0xCD
  Cmd_settorment, // 0xCE
  Cmd_jumpifnodamage, // 0xCF
  Cmd_settaunt, // 0xD0
  Cmd_trysethelpinghand, // 0xD1
  Cmd_tryswapitems, // 0xD2
  Cmd_trycopyability, // 0xD3
  Cmd_trywish, // 0xD4
  Cmd_trysetroots, // 0xD5
  Cmd_doubledamagedealtifdamaged, // 0xD6
  Cmd_setyawn, // 0xD7
  Cmd_setdamagetohealthdifference, // 0xD8
  Cmd_scaledamagebyhealthratio, // 0xD9
  Cmd_tryswapabilities, // 0xDA
  Cmd_tryimprison, // 0xDB
  Cmd_trysetgrudge, // 0xDC
  Cmd_weightdamagecalculation, // 0xDD
  Cmd_assistattackselect, // 0xDE
  Cmd_trysetmagiccoat, // 0xDF
  Cmd_trysetsnatch, // 0xE0
  Cmd_trygetintimidatetarget, // 0xE1
  Cmd_switchoutabilities, // 0xE2
  Cmd_jumpifhasnohp, // 0xE3
  Cmd_getsecretpowereffect, // 0xE4
  Cmd_pickup, // 0xE5
  Cmd_docastformchangeanimation, // 0xE6
  Cmd_trycastformdatachange, // 0xE7
  Cmd_settypebasedhalvers, // 0xE8
  Cmd_setweatherballtype, // 0xE9
  Cmd_tryrecycleitem, // 0xEA
  Cmd_settypetoterrain, // 0xEB
  Cmd_pursuitdoubles, // 0xEC
  Cmd_snatchsetbattlers, // 0xED
  Cmd_removelightscreenreflect, // 0xEE
  Cmd_handleballthrow, // 0xEF
  Cmd_givecaughtmon, // 0xF0
  Cmd_trysetcaughtmondexflags, // 0xF1
  Cmd_displaydexinfo, // 0xF2
  Cmd_trygivecaughtmonnick, // 0xF3
  Cmd_subattackerhpbydmg, // 0xF4
  Cmd_removeattackerstatus1, // 0xF5
  Cmd_finishaction, // 0xF6
  Cmd_finishturn, // 0xF7
];

export { setMoveEffect } from './bsCommands1';
export { uproarWakeUpCheck } from './bsCommands3';
