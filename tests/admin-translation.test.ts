import {afterEach,describe,expect,it,vi} from 'vitest';
import {translateCategoryCopy} from '../src/modules/admin/translation';

afterEach(()=>vi.unstubAllGlobals());

describe('admin category translation',()=>{
  it('sends bounded plain English copy and returns stored Amharic fields',async()=>{
    const provider=vi.fn<typeof fetch>(async()=>Response.json({data:{translations:[{translatedText:'ስልኮች'},{translatedText:'ሞባይል &amp; ስማርትፎኖች'}]}}));
    vi.stubGlobal('fetch',provider);
    await expect(translateCategoryCopy({name:'Phones',description:'Mobile phones & smartphones'},{NODE_ENV:'test',GOOGLE_TRANSLATE_API_KEY:'fixture-key'})).resolves.toEqual({nameAm:'ስልኮች',descriptionAm:'ሞባይል & ስማርትፎኖች'});
    const [,request]=provider.mock.calls[0];
    expect(JSON.parse(String(request?.body))).toEqual({q:['Phones','Mobile phones & smartphones'],source:'en',target:'am',format:'text'});
  });

  it('fails clearly when automatic translation is not configured',async()=>{
    await expect(translateCategoryCopy({name:'Phones',description:'Mobile phones'},{NODE_ENV:'test'})).rejects.toThrow('Automatic translation is not configured');
  });

  it('does not accept an incomplete provider response',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json({data:{translations:[{translatedText:'ስልኮች'}]}})));
    await expect(translateCategoryCopy({name:'Phones',description:'Mobile phones'},{NODE_ENV:'test',GOOGLE_TRANSLATE_API_KEY:'fixture-key'})).rejects.toThrow('incomplete result');
  });
});
